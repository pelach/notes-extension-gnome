import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

export default class NotesExtensionPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        this._settings = this.getSettings();

        // ---------------------------------------------------------------------
        // 1. BEÁLLÍTÁSOK OLDAL (Settings)
        // ---------------------------------------------------------------------
        const pageSettings = new Adw.PreferencesPage({
            title: _('Settings'),
            icon_name: 'emblem-system-symbolic',
        });
        window.add(pageSettings);

        // --- Elhelyezkedés csoport ---
        const groupPosition = new Adw.PreferencesGroup({
            title: _('Position & Behavior'),
        });
        pageSettings.add(groupPosition);

        // Pozíció kiválasztó (ComboRow)
        const positionRow = new Adw.ComboRow({
            title: _('Position of notes'),
            subtitle: _('Choose how notes are layered on the screen'),
            model: Gtk.StringList.new([
                _('Above everything'),
                _('On the background'),
                _('Cycle through 3 states')
            ]),
        });

        const currentPos = this._settings.get_string('layout-position');
        if (currentPos === 'on-background') positionRow.selected = 1;
        else if (currentPos === 'cycle-layers') positionRow.selected = 2;
        else positionRow.selected = 0;

        positionRow.connect('notify::selected', () => {
            const idx = positionRow.selected;
            if (idx === 1) this._settings.set_string('layout-position', 'on-background');
            else if (idx === 2) this._settings.set_string('layout-position', 'cycle-layers');
            else this._settings.set_string('layout-position', 'above-all');
        });
        groupPosition.add(positionRow);

        // Ikon elrejtése (SwitchRow)
        const hideIconRow = new Adw.SwitchRow({
            title: _('Hide top panel icon'),
            active: this._settings.get_boolean('hide-icon'),
        });
        hideIconRow.connect('notify::active', () => {
            this._settings.set_boolean('hide-icon', hideIconRow.active);
        });
        groupPosition.add(hideIconRow);

        // --- Billentyűkombináció csoport ---
        const groupShortcut = new Adw.PreferencesGroup({
            title: _('Keyboard Shortcut'),
        });
        pageSettings.add(groupShortcut);

        const shortcutSwitchRow = new Adw.SwitchRow({
            title: _('Use keyboard shortcut'),
            subtitle: _('Toggle notes visibility with a hotkey (Default: <Super><Alt>n)'),
            active: this._settings.get_boolean('use-shortcut'),
        });
        groupShortcut.add(shortcutSwitchRow);

        const shortcutEntryRow = new Adw.EntryRow({
            title: _('Shortcut'),
            text: this._settings.get_strv('notes-kb-shortcut')[0] || '<Super><Alt>n',
            sensitive: shortcutSwitchRow.active,
        });

        // Mentés gomb az entry-ben
        const applyBtn = new Gtk.Button({
            label: _('Apply'),
            valign: Gtk.Align.CENTER,
            css_classes: ['suggested-action'],
        });
        applyBtn.connect('clicked', () => {
            this._settings.set_strv('notes-kb-shortcut', [shortcutEntryRow.text]);
        });
        shortcutEntryRow.add_suffix(applyBtn);
        groupShortcut.add(shortcutEntryRow);

        shortcutSwitchRow.connect('notify::active', () => {
            const active = shortcutSwitchRow.active;
            this._settings.set_boolean('use-shortcut', active);
            shortcutEntryRow.sensitive = active;
        });

        // --- Színek csoport (Pasztell opciók) ---
        const groupAppearance = new Adw.PreferencesGroup({
            title: _('Appearance'),
        });
        pageSettings.add(groupAppearance);

        const PASTEL_OPTIONS = [
            { name: _('Yellow'), floatRgb: ['1.0', '0.9686', '0.8196'], rgbString: '255,247,209' },
            { name: _('Green'),  floatRgb: ['0.8862', '0.9411', '0.7960'], rgbString: '226,240,203' },
            { name: _('Pink'),   floatRgb: ['1.0', '0.8980', '0.9254'], rgbString: '255,229,236' },
            { name: _('Purple'), floatRgb: ['0.9098', '0.8745', '0.9607'], rgbString: '232,223,245' },
            { name: _('Blue'),   floatRgb: ['0.8156', '0.8823', '0.9921'], rgbString: '208,225,253' },
            { name: _('Dark'),   floatRgb: ['0.2196', '0.2196', '0.2196'], rgbString: '56,56,56' },
        ];

        const colorRow = new Adw.ComboRow({
            title: _("Default Note Color"),
            subtitle: _('Default pastel color used for new sticky notes'),
            model: Gtk.StringList.new(PASTEL_OPTIONS.map(c => c.name)),
        });

        // Betöltés a meglévő first-note-rgb beállításból
        const colorArray = this._settings.get_strv('first-note-rgb');
        let selectedIdx = 0;
        if (colorArray && colorArray.length >= 3) {
            let r = Math.round(parseFloat(colorArray[0]) * 255);
            let g = Math.round(parseFloat(colorArray[1]) * 255);
            let b = Math.round(parseFloat(colorArray[2]) * 255);

            let foundIdx = PASTEL_OPTIONS.findIndex(c => {
                let [pr, pg, pb] = c.rgbString.split(',').map(Number);
                return Math.abs(pr - r) < 15 && Math.abs(pg - g) < 15 && Math.abs(pb - b) < 15;
            });
            if (foundIdx !== -1) selectedIdx = foundIdx;
        }

        colorRow.selected = selectedIdx;

        colorRow.connect('notify::selected', () => {
            const chosen = PASTEL_OPTIONS[colorRow.selected];
            this._settings.set_strv('first-note-rgb', chosen.floatRgb);
        });

        groupAppearance.add(colorRow);


        // ---------------------------------------------------------------------
        // 2. MENTÉS / ADATOK OLDAL (Backup)
        // ---------------------------------------------------------------------
        const pageBackup = new Adw.PreferencesPage({
            title: _('Backup'),
            icon_name: 'folder-saved-search-symbolic',
        });
        window.add(pageBackup);

        const groupBackup = new Adw.PreferencesGroup({
            title: _('Data Storage'),
            description: _('Your notes are saved to disk automatically. Files ending with _state store position/color, and _text contain the note content.'),
        });
        pageBackup.add(groupBackup);

        const openFolderRow = new Adw.ActionRow({
            title: _('Storage Directory'),
            subtitle: _('Open the folder where notes are saved'),
        });

        const openFolderBtn = new Gtk.Button({
            icon_name: 'folder-open-symbolic',
            valign: Gtk.Align.CENTER,
        });
        openFolderBtn.connect('clicked', () => {
            const datadir = GLib.build_pathv('/', [GLib.get_user_data_dir(), this.metadata.uuid]);
            GLib.spawn_command_line_async('xdg-open ' + datadir);
        });

        openFolderRow.add_suffix(openFolderBtn);
        openFolderRow.activatable_widget = openFolderBtn;
        groupBackup.add(openFolderRow);


        // ---------------------------------------------------------------------
        // 3. SÚGÓ & INFO OLDAL (Help & About)
        // ---------------------------------------------------------------------
        const pageHelp = new Adw.PreferencesPage({
            title: _('Help & About'),
            icon_name: 'help-about-symbolic',
        });
        window.add(pageHelp);

        const groupHelp = new Adw.PreferencesGroup({
            title: _('Troubleshooting'),
        });
        pageHelp.add(groupHelp);

        const resetMonitorRow = new Adw.ActionRow({
            title: _('Bring back notes'),
            subtitle: _('Click if a note got stuck outside your primary monitor'),
        });

        const resetBtn = new Gtk.Button({
            label: _('Reset Position'),
            valign: Gtk.Align.CENTER,
        });
        resetBtn.connect('clicked', () => {
            this._settings.set_boolean('ugly-hack', !this._settings.get_boolean('ugly-hack'));
        });

        resetMonitorRow.add_suffix(resetBtn);
        groupHelp.add(resetMonitorRow);

        const groupAbout = new Adw.PreferencesGroup({
            title: _('About Notes'),
        });
        pageHelp.add(groupAbout);

        const versionRow = new Adw.ActionRow({
            title: _('Extension Version'),
            subtitle: (this.metadata.version ?? 'Unknown').toString(),
        });
        groupAbout.add(versionRow);

        const githubRow = new Adw.ActionRow({
            title: _('Source Code / Bug Report'),
            subtitle: this.metadata.url || '',
        });
        const githubBtn = new Gtk.Button({
            icon_name: 'adw-external-link-symbolic',
            valign: Gtk.Align.CENTER,
        });
        githubBtn.connect('clicked', () => {
            if (this.metadata.url) {
                Gio.AppInfo.launch_default_for_uri_async(this.metadata.url, null, null, null);
            }
        });
        githubRow.add_suffix(githubBtn);
        githubRow.activatable_widget = githubBtn;
        groupAbout.add(githubRow);
    }
}