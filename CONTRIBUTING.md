# Contributing

## Releases

A release is a `vX.Y.Z` tag on a commit whose `package.json` has the same version.

1. Update the version without creating a tag:

   ```sh
   npm version X.Y.Z --no-git-tag-version
   ```

2. Commit with `chore: release X.Y.Z` and push `main`. Wait for CI to pass: it is the only place the tests run on macOS and Windows.

   ```sh
   git push origin main
   ```

3. Create a signed tag and push it:

   ```sh
   git tag -s vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z
   ```

4. The Release workflow checks that the tag matches `package.json`, runs CI, stages the package on npm with provenance and creates a GitHub release with generated notes. Versions with a pre-release part (`X.Y.Z-beta.N`) go to the `next` dist-tag and are marked as pre-releases.

5. Approve the staged version with 2FA, on the Staged Packages tab on npmjs.com or from the command line:

   ```sh
   npm stage list @hexlabelposition/ward
   npm stage approve <stage-id>
   ```

A pushed tag is a release: npm versions can't be republished, so check `main` is green before tagging.

The GitHub release is created with generated notes; replace them with a written summary that ends with the generated `**Full Changelog**` line.

### First release of a new package

The trusted publisher is configured in the settings of a package on npmjs.com, so the package has to exist before CI can publish. npm creates it on the first staged publish and deletes it again, together with its settings, when its only staged version is rejected. For 0.1.0 this was solved as follows:

1. Stage a placeholder version by hand, with a number that is not the release: set `0.0.0` with `npm version 0.0.0 --no-git-tag-version`, run `bun run build` and `npm stage publish --access public`, then `git restore package.json`. Do not stage the release version itself: CI can't stage a number that is already staged.
2. Configure the trusted publisher of the new package: repository `hexlabelposition/ward`, workflow `release.yml`, environment `npm`.
3. Release as usual. If the Release workflow already failed on `Stage on npm`, re-run its failed job.
4. Approve the version staged by CI first, then reject the placeholder with `npm stage reject <stage-id>`.
