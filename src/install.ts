/**
 * @license
 * Copyright (c) 2020 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt The complete set of authors may be found
 * at http://polymer.github.io/AUTHORS.txt The complete set of contributors may
 * be found at http://polymer.github.io/CONTRIBUTORS.txt Code distributed by
 * Google as part of the polymer project is also subject to an additional IP
 * rights grant found at http://polymer.github.io/PATENTS.txt
 */

import {exec} from 'child_process';
import {promises as fs} from 'fs';
import path from 'path';
import {install} from 'pkg-install';
import pkgUp from 'pkg-up';

export type OnDemandDependencies = Map<string, string>;

/**
 * Asynchronously checks to see if a module is resolvable. This gives the
 * invoker information that is similar to what they would get from using
 * require.resolve. However, require.resolve is backed by an unclearable
 * internal cache, which this helper bypasses via a child process.
 *
 * @see https://github.com/nodejs/node/issues/31803
 */
export const assertResolvable = async (id: string) => {
  await new Promise(async (resolve, reject) => {
    exec(
        `${process.execPath} -e "require.resolve(process.env.ID)"`,
        {
          cwd: await getPackageRoot() || process.cwd(),
          env: {...process.env, ID: id}
        },
        (error) => {
          if (error != null) {
            reject(error);
            return;
          }
          resolve();
        });
  });
};

export interface ContainsOnDemandDependencies {
  [index: string]: unknown;
  installsOnDemand?: string[];
}

export const getPackageJSONPath = async(): Promise<string|null> => {
  return pkgUp({cwd: module.path});
};

export const getPackageRoot = async(): Promise<string|null> => {
  const packageJSONPath = await getPackageJSONPath();
  return packageJSONPath != null ? path.dirname(packageJSONPath) : null;
};

/**
 * Extract a map of allowed "on-demand" dependencies from a given
 * package.json-shaped object.
 */
export const onDemandDependenciesFromPackageJSON =
    (packageJSON: ContainsOnDemandDependencies): OnDemandDependencies => {
      const onDemandDependencies = new Map<string, string>();

      const onDemandList: string[] = packageJSON?.installsOnDemand || [];

      for (const packageName of onDemandList) {
        onDemandDependencies.set(packageName, '*');
      }

      return onDemandDependencies;
    };

/**
 * So-called "on-demand" dependencies are any packages that match the
 * following requirements:
 *
 *  - They are enumerated in the non-normative package.json field
 *    "installsOnDemand"
 *
 * This function resolves a map of package names and semver ranges including all
 * packages that match these requirements.
 */
export const getOnDemandDependencies = (() => {
  let cached: OnDemandDependencies|null = null;
  return async(): Promise<OnDemandDependencies> => {
    if (cached == null) {
      const packageJSONPath = await getPackageJSONPath();

      if (packageJSONPath != null) {
        const rawPackageJSON = await fs.readFile(packageJSONPath, {
          encoding: 'utf-8',
        });
        const packageJSON = JSON.parse(rawPackageJSON.toString()) as
            ContainsOnDemandDependencies;

        cached = onDemandDependenciesFromPackageJSON(packageJSON);
      }
    }

    return cached!;
  };
})();

/**
 * Install an "on-demand" package, resolving after the package has been
 * installed. Only packages designated as installable on-demand can be
 * installed this way (see documentation for "getOnDemandDependenies" for more
 * details). An attempt to install any other package this way will be rejected.
 *
 * On-demand packages are installed to this package's node_modules directory.
 * Any package that can already be resolved from this package's root directory
 * will be skipped.
 */
export const installOnDemand = async (packageName: string) => {
  try {
    await assertResolvable(packageName);
    return;
  } catch (_error) {
  }

  let dependencies = new Map();
  try {
    dependencies = await getOnDemandDependencies();
  } catch (error) {
    console.error(error);
  }

  if (!dependencies.has(packageName)) {
    throw new Error(`Package "${packageName}" cannot be installed on demand. ${
        dependencies}`);
  }

  const version = dependencies.get(packageName);

  await install({[packageName]: version}, {
    stdio: 'inherit',
    cwd: (await getPackageRoot()) || process.cwd(),
    noSave: true,
  });

  console.log(`Package "${packageName}@${version} installed."`);
};