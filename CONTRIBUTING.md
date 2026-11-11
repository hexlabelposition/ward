# Contributing

## Releases

A release is a `vX.Y.Z` tag on a commit whose `package.json` has the same version.

1. Update the version without creating a tag:

   ```sh
   npm version X.Y.Z --no-git-tag-version
   ```

2. Commit with `chore: release X.Y.Z`, tag and push:

   ```sh
   git tag vX.Y.Z
   git push origin main vX.Y.Z
   ```

3. The Release workflow checks that the tag matches `package.json`, runs CI, stages the package on npm with provenance and creates a GitHub release with generated notes. Versions with a pre-release part (`X.Y.Z-beta.N`) go to the `next` dist-tag and are marked as pre-releases.

4. Approve the staged version with 2FA, on the Staged Packages tab on npmjs.com or from the command line:

   ```sh
   npm stage list @hexlabelposition/ward
   npm stage approve <stage-id>
   ```

A pushed tag is a release: npm versions can't be republished, so check `main` is green before tagging.
