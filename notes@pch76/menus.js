import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { EventEmitter } from 'resource:///org/gnome/shell/misc/signals.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { PASTEL_COLORS } from './noteBox.js';

export class NoteOptionsMenu extends EventEmitter {
    constructor (source) {
        super();
        this.super_menu = new PopupMenu.PopupMenu(source.actor, 0.2, St.Side.LEFT);

        this.super_menu.blockSourceEvents = true;
        this._source = source;
        this.super_menu.actor.add_style_class_name('app-well-menu');

        source.actor.connect('notify::mapped', () => {
            if (!source.actor.mapped) {
                this.super_menu.close();
            }
        });
        source.actor.connect('destroy', this.super_menu.destroy.bind(this.super_menu));

        Main.uiGroup.add_child(this.super_menu.actor);
    }

    _redisplay () {
        this.super_menu.removeAll();

        // 1. Sor: Sárga, Zöld, Rózsaszín
        let row1 = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            activate: false,
            hover: false,
            can_focus: false
        });
        this._addColorButton(row1, 'yellow');
        this._addColorButton(row1, 'green');
        this._addColorButton(row1, 'pink');
        this.super_menu.addMenuItem(row1);

        // 2. Sor: Lila, Kék, Sötét
        let row2 = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            activate: false,
            hover: false,
            can_focus: false
        });
        this._addColorButton(row2, 'purple');
        this._addColorButton(row2, 'blue');
        this._addColorButton(row2, 'charcoal');
        this.super_menu.addMenuItem(row2);
    }

    _addColorButton (container, colorKey) {
        let colorData = PASTEL_COLORS[colorKey];
        if (!colorData) return;

        let [r, g, b] = colorData.rgb.split(',');

        let btn = new St.Button({
            style_class: 'notesCircleButton',
            style: `background-color: rgb(${r}, ${g}, ${b}); margin: 2px;`,
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            reactive: true,
            can_focus: true,
            track_hover: true,
        });

        btn.connect('clicked', () => {
            this._source._note.applyColorAndSave(Number(r), Number(g), Number(b));
            this.super_menu.close();
        });

        container.actor.add_child(btn);
    }

    popup (activatingButton) {
        this._redisplay();
        this.super_menu.toggle();
    }
}

export class NoteRoundButton extends EventEmitter {
    constructor (note, icon, accessibleName) {
        super();
        this._note = note;
        this.actor = new St.Button({
            child: new St.Icon({
                icon_name: icon,
                icon_size: 16,
                style_class: 'system-status-icon',
                x_expand: true,
                y_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            }),
            accessible_name: accessibleName,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'notesCircleButton notesHeaderboxButton',
            reactive: true,
            can_focus: true,
            track_hover: true,
            y_expand: false,
        });
    }

    addMenu () {
        this._menu = null;
        this._menuManager = new PopupMenu.PopupMenuManager(this.actor);
        this.actor.connect('button-press-event', this.popupMenu.bind(this));
    }

    popupMenu () {
        this.actor.fake_release();
        if (!this._menu) {
            this._menu = new NoteOptionsMenu(this);
            this._menu.super_menu.connect('open-state-changed', (menu, isPoppedUp) => {
                if (!isPoppedUp) {
                    this.actor.sync_hover();
                }
            });
            this._menuManager.addMenu(this._menu.super_menu);
        }
        this.emit('menu-state-changed', true);
        this.actor.set_hover(true);
        this._menu.popup();
        return false;
    }
}