// notes@maestroschan.fr/noteBox.js
// GPL v3
// Copyright 2018-2021 Romain F. T.
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as GrabHelper from 'resource:///org/gnome/shell/ui/grabHelper.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import * as Menus from './menus.js';
import * as Dialog from './dialog.js';
import { PATH, SETTINGS, AUTO_FOCUS, NOTES_MANAGER } from './extension.js';

const MIN_HEIGHT = 75;
const MIN_WIDTH = 200;

function stringFromArray(data) {
    if (data instanceof Uint8Array) {
        return new TextDecoder().decode(data);
    } else {
        return data.toString();
    }
}

export class NoteBox {
    constructor (id, color, fontSize, extension) {
        this.id = id;
        this._fontSize = fontSize;
        this._extension = extension;
        if (color.split(',').length == 3) {
            this.customColor = color;
        } else {
            let c = SETTINGS.get_strv('first-note-rgb');
            c[0] = c[0] * 255;
            c[1] = c[1] * 255;
            c[2] = c[2] * 255;
            this.customColor = c.toString();
        }
        this._buildNote();
    }

    _buildNote () {
        this.actor = new St.BoxLayout({
            reactive: true,
            vertical: true,
            min_height: MIN_HEIGHT,
            min_width: MIN_WIDTH,
            style_class: 'noteBoxStyle',
            track_hover: true,
        });

        this._fontColor = '';
        this._loadState();
        this._applyActorStyle();

        this._buildHeaderbar();

        this._scrollView = new St.ScrollView({
            overlay_scrollbars: true,
            x_expand: true,
            y_expand: true,
            clip_to_allocation: true,
        });

        // 1. Marad az St.Entry, de y_expand: false, hogy NE nyúljon le az aljáig
        this.noteEntry = new St.Entry({
            name: 'noteEntry',
            can_focus: true,
            hint_text: _("Type here…"),
            track_hover: true,
            x_expand: true,
            y_expand: false, // <-- NE nyúljon le függőlegesen!
            style_class: 'notesTextField',
        });

        let clutterText = this.noteEntry.get_clutter_text();
        clutterText.set_single_line_mode(false);
        clutterText.set_activatable(false);
        clutterText.set_line_wrap(true);
        clutterText.set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);

        // 2. A tároló konténert VERTIKÁLISRA állítjuk!
        this._entryBox = new St.BoxLayout({
            vertical: true, // <-- EZ A KULCS! Így a meglévő elemet a legtetejére ülteti!
            reactive: true,
            x_expand: true,
            y_expand: true,
            visible: this.entry_is_visible,
        });

        // Ha a jegyzet alsó, üres piros részére kattintasz, a kurzor akkor is beleugrik a szövegbe
        this._entryBox.connect('button-press-event', () => {
            this.noteEntry.grab_key_focus();
            return Clutter.EVENT_PROPAGATE;
        });

        this._entryBox.add_child(this.noteEntry);
        this._scrollView.set_child(this._entryBox);
        this.actor.add_child(this._scrollView);

        this._grabHelper = new GrabHelper.GrabHelper(this.noteEntry);
        if (AUTO_FOCUS) {
            this.noteEntry.connect('enter-event', this._getKeyFocus.bind(this));
            this.noteEntry.connect('leave-event', this._leaveKeyFocus.bind(this));
        } else {
            this.noteEntry.connect('button-press-event', this._getKeyFocus.bind(this));
            this.noteEntry.connect('leave-event', this._leaveKeyFocus.bind(this));
        }
        this.actor.connect('notify::hover', this._applyActorStyle.bind(this));

        this.loadIntoCorrectLayer();
        this._setNotePosition();
        this._loadText();
        this._initStyle();

        this.grabX = this._x + 100;
        this.grabY = this._y + 10;
    }

    _buildHeaderbar () {
        // 1. A konténer terjeszkedjen ki a teljes szélességben (x_expand: true),
        // és ne 'button' legyen a CSS osztálya!
        this._buttonsBox = new St.BoxLayout({
            style_class: 'noteHeaderStyle',
            x_expand: true,
            y_expand: false,
        });

        // BAL OLDALI GOMBOK
        let btnNew = new Menus.NoteRoundButton(
            this,
            'list-add-symbolic',
            _("New")
        );
        btnNew.actor.x_expand = false;
        btnNew.actor.y_expand = false;
        btnNew.actor.connect('clicked', this._createNote.bind(this));
        this._buttonsBox.add_child(btnNew.actor);

        let btnDelete = new Menus.NoteRoundButton(
            this,
            'user-trash-symbolic',
            _("Delete")
        );
        btnDelete.actor.x_expand = false;
        btnDelete.actor.y_expand = false;
        btnDelete.actor.connect('clicked', this._openDeleteDialog.bind(this));
        this._buttonsBox.add_child(btnDelete.actor);

        // KÖZÉPSŐ RUGALMAS HELY (Mozgatási felület)
        // Ez veszi fel az összes extra helyet (x_expand: true), és kitolja a jobb oldali gombokat!
        this.moveBox = new St.Button({
            x_expand: true,
            y_expand: true,
            style_class: 'notesTitleButton',
        });
        this._buttonsBox.add_child(this.moveBox);

        // JOBB OLDALI GOMBOK
        let btnOptions = new Menus.NoteRoundButton(
            this,
            'view-more-symbolic',
            _("Note options")
        );
        btnOptions.actor.x_expand = false;
        btnOptions.actor.y_expand = false;
        btnOptions.addMenu();
        this._buttonsBox.add_child(btnOptions.actor);

        let ctrlButton = new Menus.NoteRoundButton(
            this,
            'view-fullscreen-symbolic',
            _("Resize")
        );
        ctrlButton.actor.x_expand = false;
        ctrlButton.actor.y_expand = false;
        this._buttonsBox.add_child(ctrlButton.actor);

        // Eseménykezelők
        this.moveBox.connect('button-press-event', this._onMovePress.bind(this));
        this.moveBox.connect('motion-event', this._onMoveMotion.bind(this));
        this.moveBox.connect('button-release-event', this._onRelease.bind(this));

        ctrlButton.actor.connect('button-press-event', this._onResizePress.bind(this));
        ctrlButton.actor.connect('motion-event', this._onResizeMotion.bind(this));
        ctrlButton.actor.connect('button-release-event', this._onRelease.bind(this));

        this.actor.add_child(this._buttonsBox);
    }

    _openDeleteDialog () {
        let noteText = this.noteEntry.get_text();
        let lines = noteText.split("\n");
        if(lines.length > 10) {
            noteText = lines[0] + "\n" + lines[1] + "\n" + lines[2] + "\n[...]\n";
            noteText += lines[lines.length - 2] + "\n" + lines[lines.length - 1];
        }
        if(noteText === "") {
            noteText = "[" + _("Empty note") + "]";
        }

        let description_label = new St.Label({
            style: 'padding-top: 16px;',
            x_align: Clutter.ActorAlign.CENTER,
            text: noteText,
        });

        let dialog = new Dialog.CustomModalDialog(
            _("Delete this note?"),
            description_label,
            _("Delete"),
            this._deleteNoteObject.bind(this)
        );
        dialog.open();
    }

    openEditTitleDialog () {
        let titleEntry = new St.Entry({
            can_focus: true,
            track_hover: true,
            x_expand: true,
            text: "todo load existing title"
        });

        let dialog = new Dialog.CustomModalDialog(
            _("Edit title"),
            titleEntry,
            _("Apply"),
            this._applyTitleChange.bind(this)
        );
        dialog.open();
    }

    _initStyle () {
        let initialRGB_r = this.customColor.split(',')[0];
        let initialRGB_g = this.customColor.split(',')[1];
        let initialRGB_b = this.customColor.split(',')[2];
        this._applyColor(initialRGB_r, initialRGB_g, initialRGB_b);
        this._applyActorStyle();
        this._applyNoteStyle();
    }

    loadIntoCorrectLayer () {
        if (NOTES_MANAGER.notesNeedChromeTracking()) {
            Main.layoutManager.addChrome(this.actor, {
                affectsInputRegion: true
            });
        } else {
            Main.layoutManager._backgroundGroup.add_child(this.actor);
        }
    }

    removeFromCorrectLayer () {
        if (NOTES_MANAGER.notesNeedChromeTracking()) {
            Main.layoutManager.removeChrome(this.actor);
        } else {
            Main.layoutManager._backgroundGroup.remove_child(this.actor);
        }
    }

    show () {
        this.actor.visible = true;
        if (NOTES_MANAGER.notesNeedChromeTracking()) {
            Main.layoutManager.trackChrome(this.actor);
        }
    }

    onlyHide () {
        this.actor.visible = false;
        if (NOTES_MANAGER.notesNeedChromeTracking()) {
            Main.layoutManager.untrackChrome(this.actor);
        }
    }

    onlySave (withMetadata=true) {
        if(withMetadata) {
            this._saveState();
        }
        this._saveText();
    }

    fixState () {
        let outX = (this._x < 0 || this._x > Main.layoutManager.primaryMonitor.width - 20);
        let outY = (this._y < 0 || this._y > Main.layoutManager.primaryMonitor.height - 20);
        if (outX || outY) {
            [this._x, this._y] = this._computeRandomPosition();
            this._setNotePosition();
        }
        if (Number.isNaN(this._x)) { this._x = 10; }
        if (Number.isNaN(this._y)) { this._y = 10; }
        if (Number.isNaN(this.actor.width)) { this.actor.width = 250; }
        if (Number.isNaN(this.actor.height)) { this.actor.height = 200; }
        if (Number.isNaN(this._fontSize)) { this._fontSize = 10; }
        this._saveState();
    }

    _applyTitleChange () {
        this.onlySave();
    }

    _applyActorStyle () {
        if (this.actor == null) { return; }
        let is_hovered = this.actor.hover;
        let temp;
        if (is_hovered) {
            temp = 'background-color: rgba(' + this.customColor + ', 0.8);';
        } else {
            temp = 'background-color: rgba(' + this.customColor + ', 0.6);';
        }
        if (this._fontColor != '') {
            temp += 'color: ' + this._fontColor + ';';
        }
        this.actor.style = temp;

        // Nem írjuk felül hardkódolva a noteEntry stílusát, hanem meghívjuk a saját stílusbeállítóját!
        if (this.noteEntry) {
            this._applyNoteStyle();
        }
    }

    _applyNoteStyle () {
        let style = 'background-color: transparent !important; border: none !important; box-shadow: none !important; border-radius: 0px !important;';

        if (this._fontColor) {
            // Betűszín beállítása
            style += `color: ${this._fontColor} !important;`;

            // Kitöltő (placeholder) szöveg színe
            let isDarkText = (this._fontColor.toLowerCase() === '#000000' || this._fontColor.toLowerCase() === 'black');
            let hintColor = isDarkText ? 'rgba(0, 0, 0, 0.55)' : 'rgba(255, 255, 255, 0.55)';
            style += `hint-text-color: ${hintColor} !important;`;
        }

        if (this._fontSize && this._fontSize !== 0) {
            style += `font-size: ${this._fontSize}px !important;`;
        }

        this.noteEntry.style = style;
    }

    _getKeyFocus () {
        if (this.entry_is_visible) {
            this._grabHelper.grab({ actor: this.noteEntry });
            this.noteEntry.grab_key_focus();
        }
        this._redraw();
    }

    _leaveKeyFocus () {
        this._grabHelper.ungrab({ actor: this.noteEntry });
    }

    _redraw () {
        this.actor.get_parent().set_child_above_sibling(this.actor, null);
        this.onlySave();
    }

    _setNotePosition () {
        let monitor = Main.layoutManager.primaryMonitor;

        this.actor.set_position(
            monitor.x + Math.floor(this._x),
            monitor.y + Math.floor(this._y)
        );
    }

    _onMovePress (actor, event) {
        let mouseButton = event.get_button();
        if (mouseButton == 3) {
            this._entryBox.visible = !this._entryBox.visible;
            this.entry_is_visible = this._entryBox.visible;
        }
        this._onPressCommon(event);
        this._isMoving = true;
        this._isResizing = false;
    }

    _onResizePress (actor, event) {
        this._onPressCommon(event);
        this._isResizing = true;
        this._isMoving = false;
    }

    _onPressCommon (event) {
        this._redraw();
        this.grabX = Math.floor(event.get_coords()[0]);
        this.grabY = Math.floor(event.get_coords()[1]);
    }

    _onResizeMotion (actor, event) {
        if (!this._isResizing) { return; }
        let x = Math.floor(event.get_coords()[0]);
        let y = Math.floor(event.get_coords()[1]);
        this._resizeTo(x, y);
    }

    _resizeTo (event_x, event_y) {
        let newWidth = Math.abs(this.actor.width + (event_x - this.grabX));
        let newHeight = Math.abs(this._y + this.actor.height - event_y + (this.grabY - this._y));
        let newY = event_y - (this.grabY - this._y);

        newWidth = Math.max(newWidth, MIN_WIDTH);
        newHeight = Math.max(newHeight, MIN_HEIGHT);

        this.actor.width = newWidth;
        this.actor.height = newHeight;
        this._y = newY;
        this._setNotePosition();

        this.grabX = event_x;
        this.grabY = event_y;
    }

    _onMoveMotion (actor, event) {
        if (!this._isMoving) { return; }
        let x = Math.floor(event.get_coords()[0]);
        let y = Math.floor(event.get_coords()[1]);
        this._moveTo(x, y);
    }

    _moveTo (event_x, event_y) {
        let newX = event_x - (this.grabX - this._x);
        let newY = event_y - (this.grabY - this._y);

        this._y = Math.floor(newY);
        this._x = Math.floor(newX);
        this._setNotePosition();

        this.grabX = event_x;
        this.grabY = event_y;
    }

    _onRelease (actor, event) {
        this._isResizing = false;
        this._isMoving = false;
        this.onlySave();
    }

    changeFontSize (delta) {
        if (this._fontSize + delta > 1) {
            this._fontSize += delta;
            this._applyNoteStyle();
        }
        this.onlySave();
    }

    applyColorAndSave (r, g, b) {
        this._applyColor(r, g, b);
        this.onlySave();
    }

    _createNote () {
        NOTES_MANAGER.createNote(this.customColor, this._fontSize);
    }

    _applyColor (r, g, b) {
        if (Number.isNaN(r)) r = 255;
        if (Number.isNaN(g)) g = 255;
        if (Number.isNaN(b)) b = 255;
        r = Math.min(Math.max(0, r), 255);
        g = Math.min(Math.max(0, g), 255);
        b = Math.min(Math.max(0, b), 255);
        this.customColor = r.toString() + ',' + g.toString() + ',' + b.toString();
        if (r + g + b > 250) {
            this._fontColor = '#000000';
        } else {
            this._fontColor = '#ffffff';
        }
        this._applyNoteStyle();
        this._applyActorStyle();
    }

    _loadText () {
        let file2 = GLib.build_filenamev([PATH, this.id.toString() + '_text']);
        if (!GLib.file_test(file2, GLib.FileTest.EXISTS)) {
            GLib.file_set_contents(file2, '');
        }

        let file = Gio.file_new_for_path(PATH + '/' + this.id.toString() + '_text');
        let [result, contents] = file.load_contents(null);
        if (!result) {
            console.log('Could not read file: ' + PATH);
        }
        let content = stringFromArray(contents);

        this.noteEntry.set_text(content);
    }

    _saveText () {
        let noteText = this.noteEntry.get_text();
        if (noteText == null) {
            noteText = '';
        }
        let file = GLib.build_filenamev([PATH, this.id.toString() + '_text']);
        GLib.file_set_contents(file, noteText);
    }

    _computeRandomPosition () {
        let x;
        let y;
        for(var i = 0; i < 15; i++) {
            x = Math.random() * (Main.layoutManager.primaryMonitor.width - 300);
            y = Math.random() * (Main.layoutManager.primaryMonitor.height - 100);

            if (NOTES_MANAGER.areCoordsUsable(x, y)) {
                return [x, y];
            }
        }
        return [x, y];
    }

    _createDefaultState (fileName) {
        let defaultPosition = this._computeRandomPosition();
        let defaultContent = defaultPosition[0].toString() + ';'
                           + defaultPosition[1].toString() + ';'
                           + this.customColor + ';250;180;'
                           + this._fontSize + ';true;'
        GLib.file_set_contents(fileName, defaultContent);
        return defaultContent;
    }

    _loadState () {
        let fname = GLib.build_filenamev([PATH, this.id.toString() + '_state']);
        if (!GLib.file_test(fname, GLib.FileTest.EXISTS)) {
            this._createDefaultState(fname);
        }

        let file = Gio.file_new_for_path(fname);
        let [result, contents] = file.load_contents(null);
        let stringContent;
        if (!result) {
            console.log("Could not read sticky note state file: " + fname);
            stringContent = this._createDefaultState(fname);
        } else {
            stringContent = stringFromArray(contents);
        }

        let state = stringContent.split(';');
        this._x = Number(state[0]);
        this._y = Number(state[1]);
        this.customColor = state[2];
        this.actor.width = Number(state[3]);
        this.actor.height = Number(state[4]);
        this._fontSize = Number(state[5]);
        this.entry_is_visible = (state[6] == 'true');
    }

    _saveState () {
        let noteState = '';
        noteState += this._x.toString() + ';';
        noteState += this._y.toString() + ';';
        noteState += this.customColor.toString() + ';';
        noteState += this.actor.width.toString() + ';';
        noteState += this.actor.height.toString() + ';';
        noteState += this._fontSize.toString() + ';';
        noteState += this.entry_is_visible.toString() + ';';

        let file = GLib.build_filenamev([PATH, this.id.toString() + '_state']);
        GLib.file_set_contents(file, noteState);
    }

    _deleteNoteObject () {
        let noteId = this.id;
        this.destroy();
        NOTES_MANAGER.postDelete(noteId);
    }

    destroy () {
        this.actor.destroy_all_children();
        this.actor.destroy();
        this.actor = null;
    }
}