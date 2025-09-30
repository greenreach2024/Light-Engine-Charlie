# Local Desktop Setup for Realestate Reach

This guide explains how to create a local folder on your desktop and clone the
`Realestate-Reach` project from GitHub. The commands assume a macOS or Linux
terminal. Windows users can run the same commands in PowerShell (using `cd` and
`mkdir`).

## 1. Create a project folder on the desktop

```bash
cd ~/Desktop
mkdir -p Realestate-Reach
cd Realestate-Reach
```

* `cd ~/Desktop` changes to your desktop directory.
* `mkdir -p Realestate-Reach` creates a folder named `Realestate-Reach` (the
  `-p` flag prevents errors if the folder already exists).
* `cd Realestate-Reach` enters the new folder so Git will clone directly into
  it.

## 2. Clone the GitHub repository

Use SSH if you have already added your public key to GitHub, otherwise switch to
the HTTPS URL (`https://github.com/greenreach2024/Realestate-Reach.git`).

```bash
git clone git@github.com:greenreach2024/Realestate-Reach.git .
```

* The trailing `.` tells Git to clone into the current directory instead of
  creating a nested folder.
* If you see `Permission denied (publickey)` or `Network is unreachable`, verify
  your SSH key configuration or retry on a network that allows outbound SSH.

## 3. Verify the local checkout

```bash
git status
ls
```

You should see the repository files listed and `git status` should report `On
branch main` with `nothing to commit`.

## 4. Next steps

* Install project dependencies according to the repository README.
* Configure environment variables (API keys, database URLs, etc.) as documented
  in the project.
* Create a feature branch for your work before making changes:

  ```bash
  git checkout -b feature/<short-description>
  ```

By following these steps you will have a local copy of the Realestate Reach
project stored in a desktop folder and ready for development.
