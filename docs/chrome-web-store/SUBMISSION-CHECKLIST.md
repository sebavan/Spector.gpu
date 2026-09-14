# Chrome Web Store 1.0 Submission Checklist

Use this checklist after the repository changes are merged into `main`.

## 1. Create the release package

1. Confirm the `main` CI workflow is green.
2. Create and push the `v1.0.0` tag.
3. Wait for the Release workflow to finish.
4. Download `spector-gpu-v1.0.0.zip` from the GitHub release.
5. Unzip it locally and load the folder from `chrome://extensions` using **Load unpacked**.
6. Capture a frame on a WebGPU page and confirm the result viewer opens.

The ZIP root must contain `manifest.json`; do not upload a ZIP containing an extra parent directory.

## 2. Prepare the publisher account

1. Open https://chrome.google.com/webstore/devconsole.
2. Register as a Chrome Web Store developer and pay the one-time fee if needed.
3. Accept the developer agreement.
4. Set the publisher name.
5. Add and verify the contact email.
6. Optionally verify `github.com/sebavan/Spector.gpu` or another owned website through Search Console for verified-publisher display.

## 3. Upload the package

1. Select **Add new item**.
2. Upload `spector-gpu-v1.0.0.zip`.
3. Confirm the dashboard reads version `1.0.0` and Manifest V3.

## 4. Complete Store listing

Copy the fields from `docs/chrome-web-store-listing.md`.

- Language: English
- Category: Developer Tools
- Homepage: https://github.com/sebavan/Spector.gpu
- Support: https://github.com/sebavan/Spector.gpu/issues
- Mature content: No

Upload:

- `assets/store-icon-128.png`
- `assets/screenshot-result-view-1280x800.png`
- `assets/promo-small-440x280.png`
- `assets/promo-marquee-1400x560.png` as the optional marquee image

Leave the promotional video empty unless a public YouTube walkthrough has been uploaded.

## 5. Complete Privacy practices

1. Paste the single-purpose statement.
2. Paste each permission and host-permission justification.
3. Select **No, I am not using remote code**.
4. Disclose website content and web browsing activity.
5. State that the data is used only for the user-requested capture and inspection feature.
6. State that captured data is processed and stored locally and is not transferred to the developer or third parties.
7. Certify every Limited Use statement.
8. Set the privacy policy URL to:
   `https://github.com/sebavan/Spector.gpu/blob/main/PRIVACY.md`

## 6. Complete Test instructions

Paste the reviewer instructions from `docs/chrome-web-store-listing.md`. No credentials are required.

## 7. Complete Distribution

1. Choose **Public**.
2. Choose **All regions** unless a legal or policy requirement requires exclusions.
3. Confirm the extension is free and has no in-extension purchases.

For a cautious launch, choose deferred publishing in the final submission dialog. This lets review complete before manually making version 1.0 public.

## 8. Submit and monitor

1. Review every warning shown by the dashboard.
2. Select **Submit for Review**.
3. Keep publishing and rejection email notifications enabled.
4. If rejected, download or copy the exact policy message before modifying the package.
5. After approval, publish the staged item if deferred publishing was selected.
6. Update the README installation section with the final Chrome Web Store URL.
