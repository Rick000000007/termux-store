cd ~/termux-store
cat > README.md <<'EOF'
# Termux Store 🛍️

A lightweight web-based GUI store for **Termux packages**.  
It lets you install and remove packages easily using a clean App-Store style interface.

> Built for Termux users who want a simple “click to install” experience.

---

## ✨ Features

- ✅ Install packages with one click
- ❌ Remove packages with one click
- 📦 Uses official Termux repositories (`pkg`)
- 📜 Live installation logs (real-time)
- ⏱️ Shows install time timer
- 🔄 Stages shown automatically:
  - Downloading
  - Installing
  - Configuring
- 🔍 Search packages instantly
- 🧩 Filter by category
- ⭐ Featured packages
- 📚 Load All Packages (from Termux repo)
- 🌐 Online brand icons (when internet is available)
- 📵 Offline fallback icon (when internet is not available)

---

## 📦 Installation

Install using 1 command:

```bash
curl -fsSL https://raw.githubusercontent.com/Rick000000007/termux-booster-pack/main/termux-store-installer.sh | bash
