// notes@maestroschan.fr/extension.js
// GPL v3
// Copyright 2018-2021 Romain F. T.
import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import St from 'gi://St';
import Shell from 'gi://Shell';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';

import { NoteBox } from './noteBox.js';

let PATH;
let NOTES_MANAGER = null;
let SETTINGS = null;
let LAYER_SETTING = '';


export { PATH, NOTES_MANAGER, SETTINGS, LAYER_SETTING };

export default class NotesExtension extends Extension {
    enable() {
        PATH = GLib.build_pathv('/', [GLib.get_user_data_dir(), this.uuid]);
        try {
            let a = Gio.file_new_for_path(PATH);
            if (!a.query_exists(null)) {
                a.make_directory(null);
            }
        } catch (e) {
            console.log(e.message);
        }
        LAYER_SETTING = '';

        SETTINGS = this.getSettings();
        NOTES_MANAGER = new NotesManager(this);
    }

    disable() {
        if (NOTES_MANAGER) {
            NOTES_MANAGER.destroy();
            NOTES_MANAGER = null;
        }
        SETTINGS = null;
    }
}

class NotesManager {
    constructor(extension) {
        this._extension = extension;

        this.panel_button = new PanelMenu.Button(0.0, _("Show notes"), false);
        let icon = new St.Icon({
            icon_name: 'document-edit-symbolic',
            style_class: 'system-status-icon'
        });
        this.panel_button.add_child(icon);
        this.panel_button.connect(
            'button-press-event',
            this._onButtonPressed.bind(this)
        );
        this._updateIconVisibility();
        Main.panel.addToStatusArea('NotesButton', this.panel_button, 0, 'right');

        this._allNotes = new Array();
        this._notesAreVisible = false;
        this._updateLayerSetting();

        this._notesLoaded = false;

        this._bindKeyboardShortcut();
        this._connectAllSignals();
    }

    _bindKeyboardShortcut () {
        this._useKeyboardShortcut = SETTINGS.get_boolean('use-shortcut');
        if (this._useKeyboardShortcut) {
            Main.wm.addKeybinding(
                'notes-kb-shortcut',
                SETTINGS,
                Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.ALL,
                this._onButtonPressed.bind(this)
            );
        }
    }

    _loadAllNotes () {
        let i = 0;
        let ended = false;
        while(!ended) {
            let file2 = GLib.build_filenamev([PATH, i.toString() + '_state']);
            if (GLib.file_test(file2, GLib.FileTest.EXISTS)) {
                this.createNote('', 16);
            } else {
                ended = true;
            }
            i++;
        }
        this._onlyHideNotes();
        this._notesLoaded = true;
    }

    createNote (colorString, fontSize) {
        let nextId = this._allNotes.length;
        try {
            this._allNotes.push(new NoteBox(nextId, colorString, fontSize, this._extension));
        } catch (e) {
            Main.notify(_("Notes extension error: failed to load a note"));
            console.log('failed to create note n°' + nextId.toString());
            console.log(e);
        }
    }

    postDelete (deletedNoteId) {
        let lastNote = this._allNotes.pop();
        if (deletedNoteId < this._allNotes.length) {
            this._allNotes[deletedNoteId] = lastNote;
            lastNote.id = deletedNoteId;
            this._allNotes[deletedNoteId].onlySave();
        }
        this._deleteNoteFiles(this._allNotes.length);
    }

    areCoordsUsable (x, y) {
        let areaIsFree = true;
        this._allNotes.forEach(function (n) {
            if( (Math.abs(n._x - x) < 230) && (Math.abs(n._y - y) < 100) ) {
                areaIsFree = false;
            }
        });
        return areaIsFree;
    }

    notesNeedChromeTracking () {
        return this._layerId == 'above-all';
    }

    _showNotes () {
        this._notesAreVisible = true;
        this._allNotes.forEach(function (n) {
            n.show();
        });
    }

    _hideNotes () {
        this._onlyHideNotes();
        this._timeout_id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
            this._timeout_id = null;
            this._allNotes.forEach(function (n) {
                n.onlySave(false);
            });
            return GLib.SOURCE_REMOVE;
        });
    }

    _onlyHideNotes () {
        this._allNotes.forEach(function (n) {
            n.onlyHide();
        });
        this._notesAreVisible = false;
    }

    _deleteNoteFiles (id) {
        let filePathBeginning = PATH + '/' + id.toString();
        let textfile = Gio.file_new_for_path(filePathBeginning + '_text');
        let statefile = Gio.file_new_for_path(filePathBeginning + '_state');
        try { textfile.delete(null); } catch (e) {}
        try { statefile.delete(null); } catch (e) {}
    }

    _onButtonPressed () {
        if(!this._notesLoaded) {
            this._loadAllNotes();
        }

        let preventReshowing = false;
        if(LAYER_SETTING === 'cycle-layers') {
            this._allNotes.forEach(function (n) {
                n.removeFromCorrectLayer();
            });

            if(!this._notesAreVisible) {
                this._layerId = 'on-background';
                this._notesAreVisible = false;
            } else if(this._layerId === 'on-background') {
                this._layerId = 'above-all';
                this._notesAreVisible = false;
                preventReshowing = true;
            } else if(this._layerId === 'above-all') {
                this._layerId = 'above-all';
                this._notesAreVisible = true;
            }

            this._allNotes.forEach(function (n) {
                n.loadIntoCorrectLayer();
            });
        }

        if(this._allNotes.length == 0) {
            this.createNote('', 16);
            this._showNotes();
        } else if (this._notesAreVisible) {
            this._hideNotes();
        } else if (preventReshowing) {
            this._notesAreVisible = true;
        } else {
            this._showNotes();
        }
    }

    _connectAllSignals () {
        this._settingsSignals = {};

        this._settingsSignals['layout'] = SETTINGS.connect(
            'changed::layout-position',
            this._updateLayerSetting.bind(this)
        );
        this._settingsSignals['bring-back'] = SETTINGS.connect(
            'changed::ugly-hack',
            this._bringToPrimaryMonitorOnly.bind(this)
        );
        this._settingsSignals['hide-icon'] = SETTINGS.connect(
            'changed::hide-icon',
            this._updateIconVisibility.bind(this)
        );
        this._settingsSignals['kb-shortcut-1'] = SETTINGS.connect(
            'changed::use-shortcut',
            this._updateShortcut.bind(this)
        );
        this._settingsSignals['kb-shortcut-2'] = SETTINGS.connect(
            'changed::notes-kb-shortcut',
            this._updateShortcut.bind(this)
        );
    }

    _updateShortcut () {
        if(this._useKeyboardShortcut) {
            Main.wm.removeKeybinding('notes-kb-shortcut');
        }
        this._bindKeyboardShortcut();
    }

    _updateIconVisibility () {
        let now_visible = !SETTINGS.get_boolean('hide-icon');
        this.panel_button.visible = now_visible;
    }

    _bringToPrimaryMonitorOnly () {
        this._allNotes.forEach(function (n) {
            n.fixState();
        });
    }

    _updateLayerSetting () {
        this._allNotes.forEach(function (n) {
            n.removeFromCorrectLayer();
        });

        LAYER_SETTING = SETTINGS.get_string('layout-position');
        this._layerId = (LAYER_SETTING == 'on-background')
            ? 'on-background'
            : 'above-all'
        ;

        this._allNotes.forEach(function (n) {
            n.loadIntoCorrectLayer();
        });

        if(!this._notesAreVisible) {
            this._onlyHideNotes();
        }
    }

    destroy() {
        if (this._settingsSignals) {
            SETTINGS.disconnect(this._settingsSignals['layout']);
            SETTINGS.disconnect(this._settingsSignals['bring-back']);
            SETTINGS.disconnect(this._settingsSignals['hide-icon']);
            SETTINGS.disconnect(this._settingsSignals['kb-shortcut-1']);
            SETTINGS.disconnect(this._settingsSignals['kb-shortcut-2']);
        }

        this._allNotes.forEach(function (n) {
            n.onlySave(false);
            n.destroy();
        });

        if(this._useKeyboardShortcut) {
            Main.wm.removeKeybinding('notes-kb-shortcut');
        }

        this.panel_button.destroy();

        if (this._timeout_id) {
            GLib.source_remove(this._timeout_id);
            this._timeout_id = null;
        }
    }

    setActiveNote(activeNote) {
        this._allNotes.forEach(note => {
            if (note === activeNote) {
                note._setActive(true);
            } else {
                note._setActive(false);
            }
        });
    }
}
