# Publish the ATLAS source on GitHub

## Actual handover status

The source is prepared locally, with a baseline and v2 changes in Git. **It has not been pushed to a remote GitHub repository.** The Arena GitHub connector returned unsupported, and no authenticated destination was available. No public repository URL or successful publication is asserted.

Publication is a user-account action. Authenticate locally using the official GitHub CLI/browser or your normal Git credential helper. **Do not paste passwords, personal access tokens, SSH private keys or cookies into chat, source files or issue reports.**

## Recommended path (GitHub CLI)

Install Git and the official `gh` CLI on your computer. Extract the source release into its own directory, not inside an unrelated parent Git working tree. Review the files/licenses and configure your commit identity if needed.

```sh
gh auth login
# Select your own account; complete authentication in your own browser.

git config --global user.name "Your name"
git config --global user.email "Your Git commit email"

cd atlas
python scripts/publish_github.py YOUR_ACCOUNT/atlas-earth-intelligence --public
```

The helper validates the destination shape, refuses an unrelated parent Git root or existing origin, initializes `main` if needed, shows pending paths, checks for common forbidden tracked paths, and asks you to type `PUBLISH` before committing and creating/pushing a public repository. You must still review for secrets and content you do not have rights to publish. The helper does not perform authentication itself or read credentials.

If you want a private repository first, use `--private`; change visibility in GitHub only when you are ready. The same helper is usable on Linux, macOS and Windows with Python and `gh` on PATH.

## Manual equivalent

Create an **empty** repository in your own GitHub account, without auto-generated files. From the project root:

```sh
git init -b main
git status --short
# Inspect files; do not add .env, .runtime, dependency folders or secrets.
git add .
git commit -m "Release ATLAS 2.0 Earth Intelligence"
git remote add origin https://github.com/YOUR_ACCOUNT/atlas-earth-intelligence.git
git push -u origin main
```

If a Git repository already exists, do not repeat initialization/remote creation blindly. Inspect `git status`, `git branch --show-current` and `git remote -v`, then use your normal update workflow. GitHub no longer accepts an account password for HTTPS Git operations; use your authenticated CLI/credential helper or an SSH setup you control.

## What people get

- Complete original Python/TypeScript source, provider adapters, transparent model code, tests and method documentation.
- Reproducible dependency inputs/locks, local launch scripts, Docker/Compose and CI definitions.
- A source-only checkout builds the frontend using Node 24. A release ZIP can additionally contain `frontend/dist` for runtime-only Python use.
- Users do not receive `.env`, runtime SQLite data, API secrets, dependency directories, upstream repository clones or bulk data/model collections.

## After pushing

1. Inspect the repository tree and commit history for anything you did not intend to publish.
2. Run the delivered offline/build CI workflow in your account; review its logs and Docker build result. Those remote jobs were not run during this handover.
3. Review third-party notices and provider terms. Free hosted Open-Meteo access is non-commercial even though original ATLAS code is MIT.
4. Optionally create a `v2.0.0` tag and attach the verified ZIP/checksum from `scripts/package_release.py` as a Release asset.
5. Add a repository description and link to any deployment you actually operate. Do not imply the temporary Arena preview is permanent hosting.

**GitHub Pages is insufficient for the complete app:** it does not run the Python collectors/cache/API. Publish source on GitHub; run the application locally or on an appropriate Python/container host.
