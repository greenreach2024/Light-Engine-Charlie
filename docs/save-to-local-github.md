# Saving Your Work to Local GitHub Clone

These steps walk through committing project updates inside the local clone of the Buyer Registry repositories so that every change is tracked before syncing with the remote GitHub organization.

## 1. Verify the Repository Status

1. Open a terminal inside the project root (for example, `~/Desktop/Realestate-Reach`).
2. Check which files have changed:

   ```bash
   git status -sb
   ```

   Clean output means there is nothing to commit. Modified or untracked files will be listed so you can decide what to include.

## 2. Stage the Files You Want to Save

Use `git add` to stage individual files or directories. Staging lets you control exactly what goes into the next commit.

```bash
git add docs/save-to-local-github.md
# or add everything that changed
git add .
```

Run `git status` again to confirm the files are staged (they will appear under “Changes to be committed”).

## 3. Create a Commit

Once the changes are staged, record them with a commit message that summarizes the work.

```bash
git commit -m "docs: document saving updates locally"
```

Tips for a good commit message:

- Use the imperative mood (e.g., “add onboarding checklist”).
- Keep the subject line under 72 characters.
- Include a longer description after a blank line if the change is complex.

## 4. Review Local History

Inspect your commit history to verify that the commit was created correctly:

```bash
git log --oneline --decorate --graph -5
```

This shows the five most recent commits with branch names.

## 5. Prepare to Sync with GitHub

If you have network access and a configured remote (for example, `origin` pointing at `git@github.com:greenreach2024/Realestate-Reach.git`), you can push the saved work:

```bash
git push origin main
```

If the push fails because the network is unreachable, the work remains safely stored in your local commit. Re-run the push when connectivity is available.

## 6. Optional: Create a Backup Branch

When experimenting, create a branch before committing so you can propose changes without touching the main branch:

```bash
git checkout -b feature/local-save-guide
# make changes, then follow steps 2–5
```

This keeps the main branch clean and ready for releases.

---

Following these steps ensures that every update is captured in the local Git history, ready to share or push to GitHub when needed.
