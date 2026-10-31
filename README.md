<p align="center">
  <img src="src/assets/logo.svg" alt="Holdfast logo" width="120">
</p>

<h1 align="center">Holdfast</h1>

<p align="center"><b>Emergency preparation system for your household</b></p>

Holdfast is a Windows desktop app for planning how your household copes with an emergency: power cuts, floods, storms, fire, evacuation, or being cut off for a few days. It follows UK Government (GOV.UK "Be Ready") and Welsh Government guidance and is built to keep working when the internet does not.

It is a utility, not a website: dense tables, clear charts, everything saves automatically, and everything can be printed.

> This app helps you prepare. It does not replace official warnings or professional advice. **In an emergency call 999.**

## Download

**[Download the latest release](https://github.com/owentriggs/holdfast-emergency-planning-system/releases/latest)** (Windows 10 or 11, 64-bit)

| File | Use it if |
| --- | --- |
| `Holdfast.Emergency.Preparation.System.Setup.<version>.exe` | You want it installed with a Start menu shortcut. |
| `Holdfast.Emergency.Preparation.System.<version>.exe` | You want the portable version: no install, runs from anywhere, including a USB stick. |

The files are not code-signed, so Windows SmartScreen may say it "protected your PC". Click **More info**, then **Run anyway**. The release notes list SHA-256 hashes so you can check your download (`Get-FileHash .\<file>.exe` in PowerShell).

**Mac:** the "Mac build" workflow in GitHub Actions builds `Holdfast-<version>-mac-apple-silicon.dmg` and `Holdfast-<version>-mac-intel.dmg` (on the release, and under the run's Artifacts). Open the one for your Mac and drag Holdfast onto the Applications shortcut. They are not signed with an Apple certificate, so the first time, right-click the app and choose **Open**, or use **System Settings > Privacy & Security > Open Anyway**. A USB backup made on a Mac can carry the Windows version, and one made on Windows can carry the Mac version: tick **Programs for other computers**. They are downloaded once from the latest GitHub release and kept on the computer.

**Phone (Android or iPhone):** the phone app runs in the browser and can be added to the home screen, after which it works offline. It is published from this repository on GitHub Pages by the "Phone app" workflow. See [The phone app](#the-phone-app).

## What it does

| Area | What you get |
| --- | --- |
| **Dashboard** | A readiness score across your plan (contacts, water, food, first aid kit, offline maps, backups and so on) with charts and what to do next. |
| **Emergency Planner** | Household details, people (with medical needs, allergies, blood group, NHS number, role and parent / carer), pets, key locations (stopcock, fuse box, gas meter), utilities, meeting points, routes, important documents and scenario plans for 10 common emergencies. |
| **Contacts and Numbers** | Your emergency contacts plus national UK numbers (999, 111, 105 power cut, gas emergency, Floodline and more). |
| **Supplies and Stock** | Stock list with quantities, expiry dates and days of cover per person, based on the GOV.UK target of 3 days and 3 litres of water per person per day. |
| **Checklists** | Ready-made checklists (grab bag, power cut, flood and others) with progress tracking. |
| **Document Vault** | Encrypted storage for scans and photos of passports, insurance policies, deeds, prescriptions and similar. Expiry tracking and in-app viewing of PDFs and images. |
| **First Aid** | 37 step-by-step first aid guides summarised from NHS, St John Ambulance, British Red Cross and Resuscitation Council UK, plus a first aid kit inventory. |
| **Offline Library** | Save web pages (GOV.UK, NHS, Met Office, flood services and more are included as presets) so they open without internet. Update them when you are online; older versions are kept. |
| **Radio Frequencies** | UK broadcast stations, PMR446, CB and amateur calling frequencies, plus your own list. |
| **Maps** | Topographic maps you can download for an area and use offline, with your own markers. |
| **Weather and Warnings** | Forecast (Open-Meteo), Met Office weather warnings and Environment Agency flood warnings for your postcode. |
| **Calculators** | Water needed, battery and power station runtime, power bank charges, and how long the fridge and freezer stay safe in a power cut. |
| **Print Centre** | Print or save as PDF any part of the plan: the full plan, a one-page summary, chosen first aid guides, or cut-out wallet cards. **Box labels** makes signs for kit boxes, grab bags, water and food, A3 to A7, with contents and packed and check-by dates, in colour or black only. |
| **USB Backup** | Copy everything to a USB stick or external drive for your grab bag, optionally with a copy of the program that runs from the stick. |

### Emergency wallet cards

Each person in the household gets a printable card with their key medical details, emergency contacts and meeting points. Give a child a parent or carer in the Planner and the card shows "If I am found or need help, contact my parent / carer" with their names and phone numbers. A parent's card lists who they care for, so whoever helps them knows to check on the children.

## Getting started

1. **Install**: [download](#download) and run the installer, or run the portable exe, which needs no install. You can also [build it yourself](#building-from-source).
2. **Emergency Planner > Household**: enter your address and postcode (click "Look up" to fill in the map position), then add the people who live with you.
3. **Contacts**: add at least two emergency contacts, including one outside your area, and tick ICE (In Case of Emergency).
4. **Supplies**: click "Add suggestions" for a starter list, then enter what you actually have. The charts show how many days you could manage.
5. **Offline Library**: click "Add presets", then "Update all" while online so the guidance is there if the internet goes down.
6. **Maps**: zoom to your area and download it for offline use.
7. **Document Vault**: create a vault, print the recovery code, and add scans of your important documents.
8. **Print Centre**: print the plan and wallet cards and keep them with your grab bag.
9. **USB Backup**: copy it all to a USB stick for the grab bag.

Tables start empty. Where a table has an "Add suggestions" button, it adds common items you can fill in or delete. Everything saves as you type.

Keyboard shortcuts: `Ctrl+1` to `Ctrl+9` jump between the first nine pages, and `Ctrl+P` opens the Print Centre.

## Security and privacy

- **Everything stays on your computer.** There is no account, no cloud and no tracking. The app only goes online to fetch weather, warnings, postcode lookups, web pages you choose to save and map tiles, and you can turn all of that off with Offline mode in Settings.
- **Document Vault** encryption:
  - Files, names, notes and reference numbers are all encrypted with AES-256-GCM.
  - The key is derived from your password with scrypt. Nothing readable is written to disk.
  - It locks when Windows locks or sleeps, when the app closes, and after a few minutes idle. You can change the idle time.
  - A one-time recovery code unlocks it if the password is forgotten. Without the password or the recovery code, the documents cannot be recovered by anyone.
- **Plan data** (people, medical details, contacts) is stored as plain JSON in your Windows user profile, protected by your Windows login. When you back up to a USB stick you can protect it with a password.
- **Backups**: anyone holding an unprotected backup can read it. The printable PDF is never password protected.

## USB backup and sync

Plug in a USB stick or external drive and open **USB Backup**. Choose the drive, tick what to include, then click **Back up now**.

| Option | Notes |
| --- | --- |
| Plan data | Can be password protected. |
| Printable plan (PDF) | Readable on any computer or phone without the app. |
| Document vault | Copied still encrypted. |
| Offline library and map tiles | Can be large. Repeat backups only copy what changed. |
| Copy of this program | Double-click `Start Holdfast` on the stick to run the app on any Windows PC, using the data on the stick. |

The drive ends up looking like this:

```
Holdfast Backup\
  Start Holdfast                    (runs the app from the stick)
  Emergency plan <date>.pdf
  README.txt
  Data\                             (your data)
  App\                              (program files, if copied from an installed app)
```

**Two-way sync**:
- **Detecting changes:** if the copy on the stick is used on another computer and someone edits the plan or adds documents, plugging the stick back in shows a notice in the top bar.
- **Reviewing:** you see a field-by-field list of what changed on the stick, what changed on both sides (you choose which to keep), and what changed on this PC.
- **Applying:** "Apply and update drive" merges the changes and writes the result back to the stick, so both match.
- **No silent overwrites:** a backup will not overwrite changes made on the stick until you have reviewed them.

**Restore** brings a backup back onto a computer. Your current data is kept in a `before-restore` folder first.

Eject the drive with the **Eject** button before unplugging it.

## The phone app

The phone app is the same pages in a phone browser, without the parts that need the computer (maps and weather downloads, the web library, printing and USB backup). Plans and vaults are stored only in the browser on the phone, never online.

1. On the computer, back up with **Copy for the phone app** ticked. This writes `Holdfast phone.holdfast` into the backup folder: the plan (protected with the backup password if one is set) and, if ticked, the document vault, still encrypted.
2. Plug the drive into the phone (USB-C, or with an adapter). In the phone app, **Phone copy > Open phone file** and choose that file.
3. Edits made on the phone are saved with **Save changes for the computer**, which makes a `Holdfast changes <time>.holdfast` file. Save it into the drive's `Holdfast Backup` folder (or send it to the computer and use **Open a changes file...**).
4. On the computer, **USB backup** lists the changes file and opens the same review as two-way sync. Applying it renames the file to "(merged)". Make a new phone copy afterwards so the phone has the merged plan.

The vault is set up and its password changed on the computer; on the phone it can be opened, browsed and added to.

## Where data is stored

Everything lives under `%APPDATA%\Holdfast Emergency Preparation System\`. Earlier versions used `%APPDATA%\Holdfast Emergency Planning System\` or `%APPDATA%\Emergency Planning System\`; the old folder is moved across automatically the first time Holdfast starts.

| Folder | Contents |
| --- | --- |
| `data\` | Plan data, one JSON file per section. A `.bak` copy of the previous version is kept. |
| `vault\` | The encrypted document vault. |
| `webcache\` | Saved web pages (MHTML) and PDFs. |
| `tiles\` | Offline map tiles. |
| `sync-bases\` | What was last written to each backup drive, used for two-way sync. The vault part is encrypted. |
| `programs\` | Versions for other computers (for example the Mac app), downloaded for USB backups. |

**Settings and Data** has "Open data folder" and a plain JSON export and import of the plan.

## Building from source

Requires Windows and [Node.js](https://nodejs.org/) 20 or newer.

```bash
npm install
npm start
```

Build the installer and portable exe into `dist\`:

```bash
npm run dist
```

The app icon is generated from `src/assets/logo.svg` with `npm run icons`.

The Mac app is built on GitHub's Macs (`.github/workflows/mac.yml`, or `npm run dist:mac` on a Mac). The phone app is built into `web-dist\` with `npm run web`; serve that folder with any static web server to try it.

## Tests

Each test runs the real app against a throwaway data folder:

| Command | Checks |
| --- | --- |
| `npm run smoke` | Opens every page and reports console errors. Set `EPS_DEEP=1` to also capture a web page, view it offline, fetch weather, load map tiles and render the plan to PDF. |
| `npx electron scripts/edit-test.js` | Typing into the planner, the delete confirmation, and data migration. |
| `npx electron scripts/vault-test.js` | Vault encryption on disk, previews, locking, wrong password and the recovery code. |
| `npx electron scripts/usb-test.js` | Parent and carer details on wallet cards; USB backup and restore into a temp folder. |
| `npx electron scripts/rename-test.js` | Moving data from the old "Holdfast Emergency Planning System" folder, and finding and renaming old "EPS Backup" folders on USB drives. |
| `npx electron scripts/sync-test.js` | Two-way sync: edits on the drive and on the PC, conflicts, and vault documents added elsewhere. |
| `npx electron scripts/programs-test.js` | "Programs for other computers": downloading from a stand-in release server, copying to the drive, working offline and picking up a newer release. |
| `npm run web && npx electron scripts/phone-test.js` | The phone app: a password-protected phone copy opened in the real phone app, edits and a vault document added there, and the changes merged back. |

## Project layout

```
src/main/       Electron main process
  main.js         window, custom protocols (app://, tile://, vault://), IPC
  store.js        JSON file store
  vault.js        encrypted document vault
  backup.js       USB backup, restore and two-way sync
  phone.js        files carried to the phone app and back
  programs.js     Windows and Mac versions from the GitHub release, for USB backups
  merge.js        three-way merge used by sync
  webcache.js     offline web page capture
  tiles.js        map tile cache
src/renderer/   UI (plain ES modules, no framework or bundler)
  pages/          one module per page
  lib/            DOM helpers, editable table, store, print document builder
  data/           defaults, first aid guides, radio frequencies
web/            the phone app's stand-in for the main process: IndexedDB storage, vault encryption, phone files
scripts/        icon builder, phone app build and tests
```

Built with Electron, Leaflet, Chart.js and Material Design Icons.

## Sources and credits

- Guidance: [GOV.UK Be Ready](https://beready.campaign.gov.uk/), Welsh Government, NHS, St John Ambulance, British Red Cross and Resuscitation Council UK. The first aid guides are summaries; take a first aid course for proper training.
- Data:
  - Weather: [Open-Meteo](https://open-meteo.com/).
  - Weather warnings: Met Office.
  - Flood warnings: Environment Agency.
  - Postcode lookup: [postcodes.io](https://postcodes.io/).
- Maps: [OpenTopoMap](https://opentopomap.org/) (CC-BY-SA), map data © OpenStreetMap contributors. Downloads are capped and rate limited to respect the tile server. Settings accepts a custom tile URL for providers whose terms allow offline caching.
