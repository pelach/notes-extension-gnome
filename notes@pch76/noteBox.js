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
const EDGE_MARGIN = 8; // Szél-érzékelés pixelekben az átméretezéshez

// Windows Sticky Notes ihletésű 100% tömör pasztell színpaletta (RGB)
export const PASTEL_COLORS = {
    'yellow':   { name: "Yellow", rgb: '255,247,209', hex: '#fff7d1' },
    'green':    { name: "Green",  rgb: '226,240,203', hex: '#e2f0cb' },
    'pink':     { name: "Pink",   rgb: '255,229,236', hex: '#ffe5ec' },
    'purple':   { name: "Purple", rgb: '232,223,245', hex: '#e8dff5' },
    'blue':     { name: "Blue",   rgb: '208,225,253', hex: '#d0e1fd' },
    'charcoal': { name: "Dark",   rgb: '56,56,56',    hex: '#383838' },
};

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
        this.customColor = color || PASTEL_COLORS.yellow.rgb;
        
        this._isResizing = false;
        this._isMoving = false;
        this._resizeEdge = null;

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

        // 1. FEJLÉC (Alapértelmezetten rejtve)
        this._buildHeaderbar();

        // 2. GÖRGETHETŐ SZÖVEGMEZŐ
        this._scrollView = new St.ScrollView({
            overlay_scrollbars: true,
            x_expand: true,
            y_expand: true,
            clip_to_allocation: true,
        });

        this.noteEntry = new St.Entry({
            name: 'noteEntry',
            can_focus: true,
            hint_text: _("Type here…"),
            track_hover: true,
            x_expand: true,
            y_expand: false,
            style_class: 'notesTextField',
        });

        let clutterText = this.noteEntry.get_clutter_text();
        clutterText.set_single_line_mode(false);
        clutterText.set_activatable(false);
        clutterText.set_line_wrap(true);
        clutterText.set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);
        clutterText.set_use_markup(true); // Pango Markup engedélyezése formázáshoz!

        // Fókusz események bekötése (Aktiválja/rejti a fejlécet és láblécet)
        this.actor.connect('button-press-event', () => {
            NOTES_MANAGER.setActiveNote(this);
        });

        this._entryBox = new St.BoxLayout({
            vertical: true,
            reactive: true,
            x_expand: true,
            y_expand: true,
            visible: this.entry_is_visible,
        });

        this._entryBox.connect('button-press-event', () => {
            this.noteEntry.grab_key_focus();
            return Clutter.EVENT_PROPAGATE;
        });

        this._entryBox.add_child(this.noteEntry);
        this._scrollView.set_child(this._entryBox);
        this.actor.add_child(this._scrollView);

        // 3. LÁBLÉC (Formázó gombok)
        this._buildFooterbar();

        // Egér- és keretésemények az átméretezéshez
        this._initDragAndResize();

        this._grabHelper = new GrabHelper.GrabHelper(this.noteEntry);
        if (AUTO_FOCUS) {
            this.noteEntry.connect('enter-event', this._getKeyFocus.bind(this));
            this.noteEntry.connect('leave-event', this._leaveKeyFocus.bind(this));
        } else {
            this.noteEntry.connect('button-press-event', this._getKeyFocus.bind(this));
            this.noteEntry.connect('leave-event', this._leaveKeyFocus.bind(this));
        }

        this.loadIntoCorrectLayer();
        this._setNotePosition();
        this._loadText();
        this._initStyle();

        this.grabX = this._x + 100;
        this.grabY = this._y + 10;
    }

    _setActive(active) {
        if (this._isActive === active) return;
        this._isActive = active;

        if (this._buttonsBox) this._buttonsBox.visible = active;
        if (this._footerBox) this._footerBox.visible = active;

        if (active) {
            this.noteEntry.grab_key_focus();

            if (!this._stageClickId) {
                // 'captured-event': EZ A KULCS! Döntő fázis, mielőtt bárki elszívná a kattintást!
                this._stageClickId = global.stage.connect('captured-event', (stage, event) => {
                    if (!this.actor) return Clutter.EVENT_PROPAGATE;

                    // Csak egérkattintáskor (BUTTON_PRESS) vizsgálódunk
                    if (event.type() === Clutter.EventType.BUTTON_PRESS) {
                        let target = event.get_source();

                        // Ha a kattintott elem LÉTEZIK és NEM a cetlin belül van:
                        if (target && !this.actor.contains(target)) {
                            this._setActive(false);
                        }
                    }
                    return Clutter.EVENT_PROPAGATE;
                });
            }
        } else {
            if (this._stageClickId) {
                global.stage.disconnect(this._stageClickId);
                this._stageClickId = null;
            }
        }
    }   
    

    _buildHeaderbar () {
        this._buttonsBox = new St.BoxLayout({
            style_class: 'noteHeaderStyle',
            x_expand: true,
            y_expand: false,
            visible: false, // Inaktívként rejtve indul
        });

        // BAL OLDAL: Új cetli (+)
        let btnNew = new Menus.NoteRoundButton(this, 'list-add-symbolic', _("New"));
        btnNew.actor.x_expand = false;
        btnNew.actor.y_expand = false;
        btnNew.actor.connect('clicked', this._createNote.bind(this));
        this._buttonsBox.add_child(btnNew.actor);

        // KÖZÉP: Címsor / Húzható mozgatófelület
        this.moveBox = new St.Button({
            x_expand: true,
            y_expand: true,
            style_class: 'notesTitleButton',
        });
        this._buttonsBox.add_child(this.moveBox);

        // JOBB OLDAL: Színválasztó (...)
        let btnOptions = new Menus.NoteRoundButton(this, 'view-more-symbolic', _("Colors"));
        btnOptions.actor.x_expand = false;
        btnOptions.actor.y_expand = false;
        btnOptions.addMenu(); // A menus.js intézi a menüt!
        this._buttonsBox.add_child(btnOptions.actor);

        // JOBB OLDAL: Bezárás / Törlés (X)
        let btnClose = new Menus.NoteRoundButton(this, 'window-close-symbolic', _("Close"));
        btnClose.actor.x_expand = false;
        btnClose.actor.y_expand = false;
        btnClose.actor.connect('clicked', this._openDeleteDialog.bind(this));
        this._buttonsBox.add_child(btnClose.actor);

        // Mozgatási események
        this.moveBox.connect('button-press-event', this._onMovePress.bind(this));
        this.moveBox.connect('motion-event', this._onMoveMotion.bind(this));
        this.moveBox.connect('button-release-event', this._onRelease.bind(this));

        this.actor.add_child(this._buttonsBox);
    }

    _buildColorMenu(btnOptions) {
        // 1. Létrehozzuk a menüt a gombban
        btnOptions.addMenu();
        
        // 2. Elkérjük a gombra rögzített menu objektumot
        let menu = btnOptions.menu;

        if (!menu) return;

        // 3. Hozzáadjuk a színeket
        Object.keys(PASTEL_COLORS).forEach(key => {
            let color = PASTEL_COLORS[key];
            menu.addAction(_(color.name), () => {
                let [r, g, b] = color.rgb.split(',').map(Number);
                this.applyColorAndSave(r, g, b);
            });
        });
    }

    _buildFooterbar() {
        this._footerBox = new St.BoxLayout({
            style_class: 'noteFooterStyle',
            x_expand: true,
            y_expand: false,
            visible: false, // Inaktívként rejtve indul
        });

        const formatTools = [
            { icon: 'format-text-bold-symbolic', tooltip: _("Bold"), tag: 'b' },
            { icon: 'format-text-italic-symbolic', tooltip: _("Italic"), tag: 'i' },
            { icon: 'format-text-underline-symbolic', tooltip: _("Underline"), tag: 'u' },
            { icon: 'format-text-strikethrough-symbolic', tooltip: _("Strikethrough"), tag: 's' },
        ];

        formatTools.forEach(tool => {
            let btn = new Menus.NoteRoundButton(this, tool.icon, tool.tooltip);
            btn.actor.x_expand = false;
            btn.actor.y_expand = false;
            btn.actor.connect('clicked', () => {
                this._formatSelection(`<${tool.tag}>`, `</${tool.tag}>`);
            });
            this._footerBox.add_child(btn.actor);
        });

        this.actor.add_child(this._footerBox);
    }

    _formatSelection(startTag, endTag) {
        let clutterText = this.noteEntry.get_clutter_text();
        let selection = clutterText.get_selection();
        
        if (!selection || selection === '') return;

        let cursorPos = clutterText.get_cursor_position();
        let selectionBound = clutterText.get_selection_bound();

        let start = Math.min(cursorPos, selectionBound);
        let end = Math.max(cursorPos, selectionBound);

        let fullText = clutterText.get_text();
        let selectedText = fullText.substring(start, end);
        let formattedText = `${startTag}${selectedText}${endTag}`;

        clutterText.delete_text(start, end);
        clutterText.insert_text(formattedText, start);
        this.onlySave();
    }

    _getResizeEdge(event) {
        let [px, py] = event.get_coords();
        let [ax, ay] = this.actor.get_transformed_position();
        let [width, height] = this.actor.get_size();

        let relX = px - ax;
        let relY = py - ay;

        let top = relY <= EDGE_MARGIN;
        let bottom = relY >= height - EDGE_MARGIN;
        let left = relX <= EDGE_MARGIN;
        let right = relX >= width - EDGE_MARGIN;

        if (bottom && right) return 'SE';
        if (bottom && left)  return 'SW';
        if (top && right)     return 'NE';
        if (top && left)      return 'NW';
        if (right)            return 'E';
        if (bottom)           return 'S';
        if (left)             return 'W';
        if (top)              return 'N';

        return null;
    }

    _initDragAndResize() {
        this.actor.connect('button-press-event', (actor, event) => {
            let edge = this._getResizeEdge(event);
            if (edge) {
                this._isResizing = true;
                this._resizeEdge = edge;
                this._onPressCommon(event);
                
                [this._startWidth, this._startHeight] = this.actor.get_size();
                [this._startXPos, this._startYPos] = this.actor.get_transformed_position();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this.actor.connect('motion-event', (actor, event) => {
            if (this._isResizing) {
                let [px, py] = event.get_coords();
                let dx = px - this.grabX;
                let dy = py - this.grabY;

                let newWidth = this._startWidth;
                let newHeight = this._startHeight;
                let newX = this._startXPos;
                let newY = this._startYPos;

                if (this._resizeEdge.includes('E')) {
                    newWidth = Math.max(MIN_WIDTH, this._startWidth + dx);
                } else if (this._resizeEdge.includes('W')) {
                    let possibleWidth = this._startWidth - dx;
                    if (possibleWidth >= MIN_WIDTH) {
                        newWidth = possibleWidth;
                        newX = this._startXPos + dx;
                    }
                }

                if (this._resizeEdge.includes('S')) {
                    newHeight = Math.max(MIN_HEIGHT, this._startHeight + dy);
                } else if (this._resizeEdge.includes('N')) {
                    let possibleHeight = this._startHeight - dy;
                    if (possibleHeight >= MIN_HEIGHT) {
                        newHeight = possibleHeight;
                        newY = this._startYPos + dy;
                    }
                }

                this.actor.set_size(newWidth, newHeight);
                this._x = newX;
                this._y = newY;
                this._setNotePosition();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this.actor.connect('button-release-event', () => {
            if (this._isResizing) {
                this._isResizing = false;
                this._resizeEdge = null;
                this.onlySave();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
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

    _initStyle () {
        let rgb = this.customColor.split(',');
        this._applyColor(Number(rgb[0]), Number(rgb[1]), Number(rgb[2]));
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

    _applyActorStyle () {
        if (this.actor == null) { return; }
        
        // 100%-os tömör (opak) pasztell háttérszín
        let temp = `background-color: rgb(${this.customColor});`;
        if (this._fontColor != '') {
            temp += `color: ${this._fontColor};`;
        }
        this.actor.style = temp;

        if (this.noteEntry) {
            this._applyNoteStyle();
        }
    }

    _applyNoteStyle () {
        let style = 'background-color: transparent !important; border: none !important; box-shadow: none !important; border-radius: 0px !important;';

        if (this._fontColor) {
            style += `color: ${this._fontColor} !important;`;
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

    _onPressCommon (event) {
        this._redraw();
        this.grabX = Math.floor(event.get_coords()[0]);
        this.grabY = Math.floor(event.get_coords()[1]);
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
        if (Number.isNaN(g)) g = 247;
        if (Number.isNaN(b)) b = 209;
        r = Math.min(Math.max(0, r), 255);
        g = Math.min(Math.max(0, g), 255);
        b = Math.min(Math.max(0, b), 255);
        this.customColor = r.toString() + ',' + g.toString() + ',' + b.toString();
        
        // Sötét vs világos háttér szerinti betűszín választás
        if (r + g + b > 350) {
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
        // Töröljük a globális kattintásfigyelőt a cetli megsemmisítése előtt
        if (this._stageClickId) {
            global.stage.disconnect(this._stageClickId);
            this._stageClickId = null;
        }

        if (this.actor) {
            this.actor.destroy_all_children();
            this.actor.destroy();
            this.actor = null;
        }
    }
}