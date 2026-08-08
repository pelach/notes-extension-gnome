# Simple notes extension

A GNOME Shell extension providing customizable sticky notes.

![](./notes@pch76/screenshots/picture.png)



## Credits & Acknowledgments

This project is a modern fork and rewrite based on the original **Notes** extension idea by **Romain F. T.** (`notes@maestroschan.fr`).

---

## Compatible Shell Versions

| GNOME Shell Version | Supported |
|---------------------|-----------|
| **48**              | Yes       |
| **49**              | Yes       |
| **50**              | Yes       |

---

## Available Languages

| Code | Language Name |
|------|---------------|
| `en` | English       |
| `hu` | Hungarian     |

---

## Installation
## Installation

### Manual / Development Installation

1. Clone or download this repository:
   ```bash
   git clone [https://github.com/pelach/notes-extension-gnome.git](https://github.com/pelach/notes-extension-gnome.git)
   ```

2. Copy or symlink the `notes@pch76` directory to your local extension directory:
   ```bash
   ln -s ~/path/to/notes-extension-gnome/notes@pch76 ~/.local/share/gnome-shell/extensions/notes@pch76
   ```

3. Compile the translation binary (if needed):
   ```bash
   msgfmt po/hu.po -o locale/hu/LC_MESSAGES/notes@pch76.mo
   ```

4. Restart GNOME Shell (or log out and back in on Wayland) and enable the extension:
   ```bash
   gnome-extensions enable notes@pch76
   ```

---

## Storage

All note contents and metadata are saved automatically on your local disk:
* **Directory:** `~/.local/share/notes@pch76/`
* `*_state` files store coordinates, dimensions, and color options.
* `*_text` files store the actual note contents.