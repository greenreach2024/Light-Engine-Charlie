# Downloading a File from GitHub

This guide covers multiple ways to download a single file from a GitHub repository so you can work with it locally.

## 1. Download from the GitHub Web Interface

1. Open the repository in your browser and navigate to the file you want.
2. Click the file name to open the file preview.
3. Press the **Raw** button in the upper-right corner.
4. With the raw view open, use your browser's **File ▸ Save Page As** (or right-click ▸ *Save As*) and save the file to your desired folder.

> **Tip:** If your browser tries to save the file without an extension, manually add the correct extension (for example, `.ts`, `.json`, `.md`).

## 2. Copy the Raw URL for Direct Download

If you prefer a direct link that can be used in scripts or shared:

1. Open the file in GitHub and click **Raw**.
2. Copy the URL from the address bar (it will be `https://raw.githubusercontent.com/...`).
3. Use that URL with `curl` or `wget` to download the file:

   ```bash
   curl -L -o <local-file-name> "https://raw.githubusercontent.com/<owner>/<repo>/<branch>/<path-to-file>"
   ```

   Replace placeholders with the actual owner, repository name, branch, and file path.

## 3. Download via GitHub Desktop

1. Clone the repository using GitHub Desktop (`File ▸ Clone repository...`).
2. After cloning, right-click the target file in the **Changes** or **History** list and choose **Show in Explorer/Finder**.
3. Copy the file to another location if needed.

## 4. Download via Git on the Command Line

If you only need one file and do not want the entire history, you can use `git sparse-checkout`:

```bash
git clone --filter=blob:none --no-checkout https://github.com/<owner>/<repo>.git
cd <repo>
git sparse-checkout set <path-to-file>
git checkout <branch>
```

The specified file (and its parent folders) will be downloaded without retrieving the rest of the repository.

Alternatively, to download the entire repository and then copy the file:

```bash
git clone https://github.com/<owner>/<repo>.git
cd <repo>
cp <path-to-file> <destination-folder>/
```

## 5. Download via GitHub CLI (`gh`)

If you have the GitHub CLI installed and authenticated:

```bash
gh repo clone <owner>/<repo>
cd <repo>
cp <path-to-file> <destination-folder>/
```

You can also combine `gh` with `curl` by using `gh api` to fetch raw file contents:

```bash
gh api repos/<owner>/<repo>/contents/<path-to-file>?ref=<branch> --header "Accept: application/vnd.github.v3.raw" > <local-file-name>
```

## 6. Download a ZIP Snapshot for Offline Viewing

If you prefer to grab the file as part of a one-time ZIP archive (for example, to browse it without installing Git):

1. Open the repository on GitHub and click the green **Code** button near the top-right.
2. Choose **Download ZIP**. GitHub will generate a compressed archive of the current branch.
3. Once downloaded, extract the ZIP (double-click on macOS/Windows or run `unzip <archive>.zip` on the command line).
4. Navigate through the extracted folders to locate the file you need and open it locally.

> **Tip:** The ZIP always reflects the branch selected in GitHub. Switch to the correct branch or tag before clicking **Download ZIP** if you need a specific revision.

## 7. Verify the Downloaded File

Regardless of the method, verify the file integrity by checking:

- The file size matches expectations.
- The contents open correctly in your editor.
- Optionally, compare a checksum (`shasum -a 256 <file>`) against a known value.

## Troubleshooting

- **Permission errors:** Ensure the repository is public or that you have access rights if it's private.
- **Network issues:** Retry the download on a stable connection or use a VPN if corporate firewalls block GitHub.
- **Binary files:** For non-text files (images, PDFs), ensure you download via `Raw` or command-line tools to avoid GitHub rendering artifacts.

These approaches give you flexibility whether you're on a desktop GUI, command line, or using automation scripts.
