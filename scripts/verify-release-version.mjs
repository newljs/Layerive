import { readFile } from 'node:fs/promises';

if (process.env.GITHUB_REF_TYPE !== 'tag') process.exit(0);

const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const tag = process.env.GITHUB_REF_NAME;
if (tag !== `v${version}`) {
  console.error(`Release tag ${tag} does not match package version ${version}.`);
  process.exit(1);
}

console.log(`Release tag ${tag} matches package version ${version}.`);
