# THEIA - Hub de Surveillance IoT Terrain

> **"La ou l'oeil est aveugle, l'onde revele"**

THEIA est une webapp full-stack de surveillance terrain deployee sur Raspberry Pi 5.
Elle recoit en temps reel les detections LoRa de capteurs microwave (LD2450 / C4001),
les affiche sur une carte interactive, et fournit un tableau de bord operationnel complet.

**THEIA Hub Control v1.0** - (c) 2026 Yoann ETE

---

## Architecture

```
Capteurs MW (TX LoRa)  --433MHz-->  Heltec RX (USB)  -->  Raspberry Pi 5
                                                            |
                                                    +-------+-------+
                                                    |               |
                                              FastAPI :8000    Next.js :3000
                                              (backend)        (frontend)
                                                    |               |
                                              SQLite DB        Dashboard
                                              GPS / LoRa       Carte / Logs
```

| Composant | Stack | Port |
|-----------|-------|------|
| Frontend | Next.js 16 + shadcn/ui + Tailwind CSS 4 | 3000 |
| Backend | FastAPI + SQLite + pyserial + gpsd | 8000 |
| Firmware | Arduino (ESP32 Heltec WiFi LoRa V3) | - |
| Preview | Vercel (mock data statique) | - |

## Fonctionnalites

### Dashboard
- Monitoring Raspberry Pi en temps reel (CPU, RAM, disque, temperature)
- Etat des connexions : Wi-Fi, Ethernet, GPS, LoRa RX
- Alertes actives (batterie faible, signal RSSI faible, device offline)
- Notifications en temps reel via SSE

### Missions
- Creation et gestion de missions de surveillance
- Carte interactive Leaflet avec zones de detection personnalisables
- Mode visualisateur plein ecran (carte grand ecran + barre TX compacte)
- Detection en temps reel avec direction, distance, vitesse
- Mode FOV (champ de vision des capteurs) et estimation de position
- Mode timelapse pour replay des detections
- Heatmap des evenements
- Sourdine par capteur (masquer un TX du feed de detection)
- Export CSV des evenements

### Devices (Capteurs)
- Provisioning automatique : flash firmware Arduino via la webapp
  - Detection automatique des ports USB avec identification (VID/PID, fabricant)
  - Selection du type de capteur (LD2450 ou C4001)
  - Compilation et upload du sketch avec TX_ID configure
  - Console de flash en temps reel (SSE streaming)
  - Enregistrement automatique du device en base
- Enrollment manuel pour devices pre-configures
- Monitoring batterie (voltage) et signal RSSI en temps reel
- Attribution a une mission et zone de surveillance

### Logs
- Logs applicatifs filtres par source et niveau
- Logs systeme du Raspberry Pi (journalctl theia-api)
- Logs device (connexions, deconnexions, alertes)
- Recherche, filtrage et export

### Notifications
- Cloche de notification dans le sidebar avec badge
- Alertes automatiques :
  - Batterie critique (< 3.3V) ou faible (< 3.5V)
  - Signal RSSI faible (< -90dBm)
  - Device offline (pas de signal > 120s)
  - Reconnexion de device
- Anti-spam : 1 notification par type/device par heure
- Section alertes actives sur le dashboard
- Dismiss individuel ou global

### Administration
- Configuration Wi-Fi (scan, connexion, reseaux sauvegardes)
- Configuration Ethernet
- Tailscale VPN (up/down, exit node, peers)
- Gestion Git (branches, commits, pull, mise a jour)
- Mise a jour automatique depuis la webapp (stash + pull + install + restart)
- Sauvegardes (creation, restauration, suppression)
- Redemarrage / arret du Raspberry Pi
- Guide d'utilisation integre
- Licence

## Arborescence

```
theia/
  app/                    # Next.js App Router (pages)
    (app)/
      dashboard/          # Monitoring hub (CPU, RAM, GPS, LoRa, alertes)
      missions/           # CRUD missions + carte + visualisateur
      devices/            # Capteurs TX (provisioning, flash, monitoring)
      logs/               # Viewer logs (applicatifs + systeme Pi)
      admin/              # Configuration reseau, Git, sauvegardes
    api/                  # API Routes (mock en preview, proxy en pi)
  components/             # Composants UI (shadcn + custom)
    dashboard/            # Cards status, alertes
    mission/              # Carte Leaflet, overlays, floor plans
    ui/                   # shadcn/ui
    notification-bell.tsx # Cloche de notifications globale
    theia-footer.tsx      # Footer copyright global
  hooks/                  # use-api (SWR), use-sse (EventSource)
  lib/                    # Types, mock-data, api-client, format
  firmware/               # Sketches Arduino ESP32
    TX_LD2450/            # Template capteur HLK-LD2450
    TX_C4001/             # Template capteur DFRobot C4001
  backend/                # FastAPI Python
    routers/              # health, missions, devices, events, logs, stream,
                          # tiles, admin, config, notifications, firmware
    services/             # system_monitor, gps_reader, lora_bridge
    database.py           # SQLite init + schema (devices, events, logs,
                          #   missions, zones, sensor_placements, notifications)
    main.py               # App FastAPI + startup + CORS
    sse.py                # SSE broadcast manager
    requirements.txt
  services/               # Fichiers systemd
    theia-api.service
    theia-web.service
  scripts/                # Scripts utilitaires
    setup-udev-rules.sh   # Regles udev pour /dev/theia-rx, /dev/theia-gps
  install.sh              # Script d'installation automatique (idempotent)
  .env.example            # Template variables d'environnement
```

## Installation sur Raspberry Pi

### Prerequis

- Raspberry Pi 5 (ou 4) sous Raspberry Pi OS (Bookworm 64-bit)
- Acces internet pour l'installation initiale
- Heltec LoRa RX branche en USB
- (Optionnel) GPS USB
- (Optionnel) Capteur(s) TX ESP32 a flasher

### 1. Cloner le repo

```bash
cd ~
git clone https://github.com/Yo-ETE/v0-theia-webapp-development.git theia
cd theia
```

### 2. Lancer l'installation

```bash
chmod +x install.sh
sudo bash install.sh
```

Le script est **idempotent** : relancez-le autant de fois que necessaire.

| Etape | Action |
|-------|--------|
| 1 | `apt update/upgrade` + installation des dependances systeme |
| 1b | Installation `arduino-cli` + core ESP32 (pour flash firmware) |
| 2 | Installation Node.js 20.x via NodeSource |
| 3 | Creation `/opt/theia/{app,data,tiles,logs}` |
| 4 | Copie des fichiers (rsync) |
| 5 | `.env.example` -> `.env` (force `NEXT_PUBLIC_MODE=pi`) |
| 6 | Python venv + `pip install -r backend/requirements.txt` |
| 7 | `npm ci` + `npm run build` (Next.js standalone) |
| 8 | Configuration gpsd si GPS detecte |
| 9 | Configuration udev (`/dev/theia-rx`, `/dev/theia-gps`) |
| 10 | Installation services systemd + demarrage |

### 3. Resultat attendu

```
============================================
  THEIA - Installation Complete
============================================

  Web UI:     http://192.168.1.42:3000
  API:        http://192.168.1.42:8000
  Tailscale:  http://100.x.x.x:3000
  API Docs:   http://localhost:8000/docs

  Service Status:
    theia-api            active
    theia-web            active
    gpsd                 active

  [  OK ] All checks passed. THEIA is ready.
```

## Mise a jour

### Depuis la webapp (recommande)

1. Aller dans **Administration** > section **Gestion Git**
2. Selectionner la branche
3. Cliquer sur **Mettre a jour**

La webapp execute automatiquement :
```
git stash -> git pull -> chmod +x install.sh -> sudo bash install.sh
-> pip install -r requirements.txt -> systemctl restart theia-api theia-web
```

### Depuis le terminal

```bash
cd ~/theia
git stash
git pull
chmod +x install.sh
sudo bash install.sh
```

## Provisioning d'un capteur TX

### Depuis la webapp (recommande)

1. Brancher l'ESP32 en USB sur le Pi
2. Aller dans **Devices** > **Nouveau capteur**
3. Entrer le TX_ID (ex: TX03) -- la webapp verifie l'unicite
4. Selectionner le type (LD2450 ou C4001)
5. Selectionner le port USB -- la webapp affiche le fabricant et le VID/PID
6. Cliquer **Compiler & Flash**
7. Suivre la console en temps reel
8. Le device est enregistre automatiquement en base

### Manuellement

1. Ouvrir le sketch dans Arduino IDE (`firmware/TX_LD2450/` ou `firmware/TX_C4001/`)
2. Remplacer `__TX_ID__` par l'identifiant souhaite (ex: `TX03`)
3. Selectionner la board `esp32:esp32:heltec_wifi_lora_32_V3`
4. Compiler et upload
5. Enregistrer le device dans la page Devices

## Variables d'environnement

Le fichier `.env` est cree automatiquement par `install.sh` :

```bash
# Mode : preview (mock) ou pi (reel)
NEXT_PUBLIC_MODE=pi
NEXT_PUBLIC_API_URL=/api
THEIA_BACKEND_URL=http://localhost:8000

# Base SQLite
DB_PATH=/opt/theia/data/theia.db

# GPS USB
GPS_DEVICE=/dev/theia-gps

# LoRa Heltec RX USB
LORA_SERIAL_PORT=/dev/theia-rx
LORA_BAUD_RATE=115200

# Carte : online ou offline
MAP_MODE=online
MAP_TILE_DIR=/opt/theia/tiles
```

## Format des trames LoRa

Les capteurs TX envoient via LoRa 433MHz au format :

```
LD45;TX01;x;y;d;v;battV
```

| Champ | Description | Exemple |
|-------|------------|---------|
| `LD45` | Header protocole | `LD45` |
| `TX01` | Identifiant du capteur | `TX01` |
| `x` | Coordonnee X en cm | `-40` |
| `y` | Coordonnee Y en cm | `63` |
| `d` | Distance en cm | `75` |
| `v` | Vitesse en cm/s | `-8` |
| `battV` | Tension batterie en V | `4.07` |

Pour le C4001 (profondeur uniquement) : `x=0`, `y=d`.

## Commandes utiles (Pi)

```bash
# Status des services
sudo systemctl status theia-api theia-web

# Logs en temps reel
sudo journalctl -u theia-api -f
sudo journalctl -u theia-web -f

# Redemarrer
sudo systemctl restart theia-api theia-web

# Sante de l'API
curl http://localhost:8000/api/health

# Documentation Swagger
# http://<IP_DU_PI>:8000/docs
```

## Carte offline

Pour un deploiement terrain sans internet :

1. Modifier `.env` : `MAP_MODE=offline`
2. Telecharger les tuiles OSM dans `/opt/theia/tiles/{z}/{x}/{y}.png`
3. Le backend sert les tuiles via `/tiles/{z}/{x}/{y}.png`

## Tailscale VPN

THEIA est accessible via Tailscale sans configuration supplementaire :

```bash
sudo tailscale up --accept-dns=false
```

L'app sera accessible sur le reseau local ET via l'adresse Tailscale (100.x.x.x).

## Stack technique

| Couche | Technologie |
|--------|------------|
| Frontend | Next.js 16, React 19, Tailwind CSS 4, shadcn/ui |
| Data fetching | SWR + SSE (Server-Sent Events) |
| Carte | Leaflet + react-leaflet |
| Backend | FastAPI, Uvicorn, Pydantic |
| Base de donnees | SQLite |
| GPS | gpsd + gpsd-py3 |
| LoRa | pyserial (lecture trames serie) |
| Firmware | Arduino ESP32 (Heltec WiFi LoRa V3) |
| Flash | arduino-cli (compile + upload depuis la webapp) |
| Monitoring | psutil (CPU, RAM, disk, temperature) |
| Deploiement | systemd (2 services) |

## Troubleshooting

### `npm ERESOLVE` (react-leaflet)

Le `.npmrc` contient `legacy-peer-deps=true`. Verifier sa presence :
```bash
cat ~/theia/.npmrc
```

### `git pull` echoue

```bash
cd ~/theia && git stash && git pull && chmod +x install.sh && sudo bash install.sh
```

### Un service ne demarre pas

```bash
sudo journalctl -u theia-api -n 50 --no-pager
sudo journalctl -u theia-web -n 50 --no-pager
```

### Le GPS n'est pas detecte

```bash
ls -la /dev/theia-gps
gpsmon
sudo dpkg-reconfigure gpsd
```

### L'API ne repond pas

```bash
curl -v http://localhost:8000/api/health
ss -tlnp | grep 8000
```

### Erreur `python-multipart` ou import Python

```bash
sudo /opt/theia/.venv/bin/pip install -r /opt/theia/app/backend/requirements.txt
sudo systemctl restart theia-api
```

## Licence

Projet prive - (c) 2026 Yoann ETE - Tous droits reserves.
