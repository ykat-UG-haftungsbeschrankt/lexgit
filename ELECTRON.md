# Desktop application

The Electron app uses the same React UI and law/Git API as the browser app. Its
local server binds only to `127.0.0.1` on a randomly allocated port and requires
the desktop session cookie for API access. Editable files remain in the selected
repository, not inside the application bundle.

## Run and package

Install dependencies with `npm install`, then:

```sh
npm run electron:build
npm run electron:start
npm run electron:dist
```

`electron:start` opens the existing desktop build without rebuilding. Run
`electron:build` explicitly after source changes or before the first launch.
Ordinary browser development and checks do not build Electron.
`electron:dist` explicitly builds and produces an
installer for the host platform in `release/`: Linux AppImage, Windows NSIS, or
macOS DMG. `electron:pack` creates an unpacked application for testing. The VS Code
**Build Electron application** task also produces the installer.

Packaging uses Electron's Node runtime, including on development hosts using
Node 20. Windows and macOS installers should be built and tested on their
respective platforms. Signing and custom icons are not configured.

## Open a repository

At startup, choose either:

- **Lokales Repository öffnen**: choose a folder in an existing Git repository.
- **Repository klonen und öffnen**: enter an HTTPS or SSH Git URL and choose a
  parent folder. A new `office-law-*` directory is created there. A failed clone
  is cleaned up; an existing folder is never overwritten.

Git must be installed and available on `PATH`. Private repositories use the
system Git credential helper or SSH keys. Interactive password prompts are not
supported; do not embed passwords or tokens in the URL.

Only open trusted repositories: Git filters and commit hooks can execute local
code. The app asks for confirmation before opening or cloning. It creates a
`laws/` folder if necessary. Existing laws must use the app's manifest and
XML format (`laws/<slug>/law.json` and `norms/`). Empty repositories can add
laws through the browser management controls.

Use Ctrl+K (or Command+K on macOS) to focus the provision search. The clear
button restores the full contents list. The law picker closes with Escape
or an outside click and is disabled during editing, saving, or history viewing.
Failed library or law loads offer **Erneut versuchen** without restarting
the application.

Edits and commits operate on the selected repository. No automatic commits,
fetches, pulls, or pushes are performed. **Repository → Repository wechseln**
returns to the launcher; save any open draft before switching.

## Save and load changes with patches

Use **Änderungen importieren / exportieren** in the library sidebar or on the
empty-library screen:

- **Export-Vorschau laden** shows saved changes across `laws/` relative to HEAD.
  Download the preview as `gesetzesbibliothek.patch`. Added and deleted laws,
  staged changes, and untracked law files are included; ignored files, unsaved
  editor drafts, and files outside `laws/` are excluded. Export does not alter
  the real Git index.
- Select a `.patch` or `.diff` file to check it and preview the affected files.
  **Patch anwenden** applies it only if it still matches the current library.
  Conflicts or invalid law files reject the import without applying the patch.
  The library reloads after a successful import, including additions/deletions.

Patches require the matching base content; they are not full backups and do not
contain Git history. An already-applied patch will normally conflict. Import
accepts text patches up to 8 MiB targeting law manifests and norm XML,
not arbitrary repository files, symlinks, or rename/copy records. The app
exports renames as deletion/addition pairs. Import leaves staging and HEAD
unchanged and does not create a commit. Review imported changes before
committing them.

## Norm files and editing

Each provision or section is a standalone `norm` XML document, with GII-style
`metadaten` and `textdaten`. Hierarchy directories remain unchanged; sections
use `index.xml`, and provisions use their identifier plus `.xml`. `law.json`
retains law metadata, ordering, and the document-number-to-path mapping.

The viewer and editor display legal text, not XML source. Blank lines separate
paragraphs. Saving escapes XML characters and updates only edited paragraphs;
unchanged paragraphs retain their imported markup. Footnotes, unrelated
metadata, and annotations remain intact. XML imports preserve the original
norm elements rather than reducing them to Markdown. Plain-text paragraphs
created by the app carry `office-law-text="plain"` to preserve exact whitespace.

XML imports and editor saves normalize tag and attribute names to lowercase,
sort attributes by name, and use tab indentation with structural opening and
closing tags on separate lines. Simple `p`, `dt`, and `dd` elements occupy
one line each; nested blocks get their own indented lines, including inside
mixed-text paragraphs. Inline markup stays with its surrounding text.
Preformatted, plain-text, and `xml:space="preserve"` content stay untouched.
Repeated saves produce the same formatting, keeping later diffs localized.
Existing files are normalized when saved, not rewritten in bulk. Git patches
retain their exact supplied contents so they still match their base versions.

Legacy Markdown remains readable in historical commits and compatible patches.
New imports, provisions, and structure changes use XML. To migrate another
existing library, run `node scripts/migrate-laws.mjs [repository-directory]`.
The migration keeps existing folders and metadata, verifies round-trip text,
and does not create commits or restore deleted laws. Review the diff afterward.

### Tiptap visual content editing

Use **Bearbeiten** for inline Tiptap editing, or **XML bearbeiten** for the
same draft in source mode. **Inhalt visuell bearbeiten** switches back to
Tiptap. Select text for bold/italic; the toolbar adds paragraphs, unordered
or numeric ordered lists, and legal description lists. XML remains the
persistent format. Metadata and footnotes are not rewritten by the editor.

GII definition lists (`DL/DT/DD/LA`), including nested lists inside paragraphs,
have dedicated Tiptap nodes. A structured entry always contains a DT/DD pair;
mixed paragraphs use explicit text-run and nested-block nodes rather than
invalid HTML paragraphs containing lists. Labels and text support editing
and bold/italic. XML attributes remain attached to their original elements.
Select an entry's label or body, then use the toolbar to move up/down,
delete, indent, or outdent. Tab and Shift+Tab indent and outdent pairs.
Enter inside a legal text run inserts a line break.
Click outside the block to hide it, or press Escape while in the toolbar.
Tab inside an entry nests it under the preceding entry; Shift+Tab lifts it
one level. Labels are kept unchanged, not automatically renumbered.
Deleting an entry also deletes its nested entries. When lifting an entry,
following siblings become its children to preserve their relative order.
Use **Davor einfügen** to insert a blank DT/DD pair before an entry, or
**Neuer Eintrag** to insert one after the selected entry.
Fill in its label and body directly; labels are not generated automatically.
Create a new legal list with **Juristische Liste**.

The schema and paired-entry commands live in `src/tiptap/legal-xml.ts`.
`OfficeLawTiptapXml` converts Tiptap documents through the existing
`OfficeLawRichContent` XML mapping, retaining lexical source information.
Unchanged drafts round-trip byte-for-byte. Text-only edits preserve untouched
source ranges; structural changes may reserialize the affected block.
Legacy Editor.js tools remain for compatibility, not as the active editor.

Other complex structures, such as tables or unsupported inline markup,
are preserved as protected XML blocks. Use
**Baumansicht** or **XML-Quelltext** to edit or remove those structures.
The visual editor prevents protected-block deletion. List checkboxes and
custom numbering are not supported by the XML mapping.

Switching views and saving first flush pending Tiptap changes. Closing the
dialog discards the unsaved draft; saving validates XML and checks the loaded
file version before writing. The existing save API still normalizes XML
formatting as described above. No Git commit is created.
