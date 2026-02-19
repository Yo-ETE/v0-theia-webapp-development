# THEIA - IoT Surveillance Hub

Webapp full-stack de supervision pour Raspberry Pi 5, servant de hub terrain IoT.
Recoit des detections LoRa (capteurs microwave TX) via un recepteur Heltec USB,
localise le hub via GPS USB, et affiche tout en temps reel dans un dashboard ops.

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
| Frontend | Next.js 16 + shadcn/ui + Tailwind | 3000 |
| Backend | FastAPI + SQLite + pyserial + gpsd | 8000 |
| Preview | Vercel (mock data statique) | - |

## Arborescence

```
theia/
  app/                    # Next.js App Router (pages)
    (app)/
      dashboard/          # Etat du hub (CPU, RAM, GPS, LoRa, alertes)
      missions/           # CRUD missions + carte + historique
      devices/            # Table TX (enrolement, RSSI, zone)
      logs/               # Viewer logs (filtres, recherche, export)
    api/                  # API Routes (mock en preview, proxy en pi)
  components/             # Composants UI (shadcn + custom)
    dashboard/            # Cards status, alertes, reseau
    mission/              # Carte Leaflet, overlays
    ui/                   # shadcn/ui
  hooks/                  # use-api (SWR), use-sse (EventSource)
  lib/                    # Types, mock-data, api-client, format
  backend/                # FastAPI Python
    routers/              # health, missions, devices, events, logs, stream, tiles
    services/             # system_monitor, gps_reader, lora_bridge
    database.py           # SQLite init + helpers
    main.py               # App FastAPI + startup
    sse.py                # SSE broadcast manager
    requirements.txt
  services/               # Fichiers systemd
    theia-api.service
    theia-web.service
  install.sh              # Script d'installation automatique (idempotent)
  .env.example            # Template variables d'environnement
```

## Installation sur Raspberry Pi

### Prerequis

- Raspberry Pi 5 (ou 4) sous Raspberry Pi OS (Bookworm 64-bit recommande)
- Acces internet pour l'installation initiale
- (Optionnel) GPS USB branche sur `/dev/ttyUSB0`
- (Optionnel) Heltec LoRa RX USB branche sur `/dev/ttyACM0`

### 1. Cloner le repo

```bash
cd ~
git clone -b v0/yo-ete-f9e98eda https://github.com/Yo-ETE/v0-theia-webapp-development.git theia
cd theia
```

> **Note** : la branche de developpement active est `v0/yo-ete-f9e98eda`.
> Une fois stabilise, le code sera merge sur `main`. Pour cloner `main` :
> `git clone https://github.com/Yo-ETE/v0-theia-webapp-development.git theia`

### 2. Lancer l'installation

```bash
chmod +x install.sh
sudo ./install.sh
```

Le script est **idempotent** : vous pouvez le relancer autant de fois que necessaire sans risque.

Il execute automatiquement :

| Etape | Action |
|-------|--------|
| 1 | `apt update/upgrade` + install python3-venv, nodejs, gpsd, sqlite3... |
| 2 | Installation Node.js 20.x via NodeSource (skip si deja present) |
| 3 | Creation `/opt/theia/{app,data,tiles,logs}` |
| 4 | Copie des fichiers vers `/opt/theia/app` (rsync) |
| 5 | `.env.example` -> `.env` + force `NEXT_PUBLIC_MODE=pi` |
| 6 | Python venv + `pip install backend/requirements.txt` |
| 7 | `npm ci` + `npm run build` (Next.js standalone) |
| 8 | Configuration gpsd si GPS detecte |
| 9 | Installation services systemd + `enable --now` |
| 10 | Verification : `systemctl status` + `curl /health` + affichage IPs |

### 3. Resultat attendu

A la fin de l'installation, le script affiche :

```
============================================
  THEIA - Installation Complete
============================================

  Web UI:     http://192.168.1.42:3000
  API:        http://192.168.1.42:8000

  Tailscale:  http://100.x.x.x:3000

  Dashboard:  http://localhost:3000/dashboard
  API Docs:   http://localhost:8000/docs

  Service Status:
    theia-api            active
    theia-web            active
    gpsd                 active

  [  OK ] All checks passed. THEIA is ready.
```

## Variables d'environnement

Le fichier `.env` est cree automatiquement par `install.sh` depuis `.env.example` :

```bash
# Mode : preview (mock) ou pi (reel)
NEXT_PUBLIC_MODE=pi

# Le frontend fetch toujours /api (routes Next.js)
# Les routes proxy vers le backend en mode pi
NEXT_PUBLIC_API_URL=/api
THEIA_BACKEND_URL=http://localhost:8000

# Base SQLite
DB_PATH=/opt/theia/data/theia.db

# GPS USB
GPS_DEVICE=/dev/ttyUSB0

# LoRa Heltec RX USB
LORA_SERIAL_PORT=/dev/ttyACM0
LORA_BAUD_RATE=115200

# Carte : online (OSM CDN) ou offline (tuiles locales)
MAP_MODE=online
MAP_TILE_DIR=/opt/theia/tiles
```

## Preview Vercel

Le frontend est deployable sur Vercel pour preview live.
En mode `preview` (defaut sur Vercel) :

- Les API Routes (`/api/*`) retournent des **mock data statiques** realistes
- Pas de WebSocket/SSE actif
- Carte Leaflet en mode online (tuiles OSM)
- Aucun backend Python requis

Le mecanisme est transparent :

```
Frontend  -->  /api/missions  -->  API Route Next.js
                                     |
                            NEXT_PUBLIC_MODE === "preview"
                              ? return mock data
                              : proxy vers THEIA_BACKEND_URL
```

## Commandes utiles (sur le Pi)

```bash
# Status des services
sudo systemctl status theia-api
sudo systemctl status theia-web

# Logs en temps reel
sudo journalctl -u theia-api -f
sudo journalctl -u theia-web -f

# Redemarrer un service
sudo systemctl restart theia-api
sudo systemctl restart theia-web

# Re-deployer apres un git pull
cd ~/theia
git pull
sudo ./install.sh

# Verifier la sante de l'API
curl http://localhost:8000/api/health

# Documentation API (Swagger auto)
# Ouvrir dans un navigateur :
# http://<IP_DU_PI>:8000/docs
```

## Mise a jour

```bash
cd ~/theia
git stash
git pull
sudo ./install.sh
```

> **`git stash`** permet d'eviter les conflits si `install.sh` ou d'autres fichiers
> ont ete modifies localement (ex: `chmod +x`). Le `install.sh` recopie tout dans
> `/opt/theia/app` donc les changements locaux ne sont pas perdus.

Le script detecte les fichiers deja en place, ne reinstalle que le necessaire,
rebuild le frontend, et redemarre les services.

### En cas d'erreur git pull

Si `git pull` echoue avec "Your local changes would be overwritten" :

```bash
cd ~/theia
git checkout -- .
git pull
sudo ./install.sh
```

## Carte offline (optionnel)

En mode terrain sans internet, la carte peut servir des tuiles locales :

1. Modifier `.env` sur le Pi :
   ```
   MAP_MODE=offline
   ```

2. Telecharger les tuiles OSM pour votre zone dans `/opt/theia/tiles/` :
   ```
   /opt/theia/tiles/{z}/{x}/{y}.png
   ```

3. Le backend FastAPI sert les tuiles via `/tiles/{z}/{x}/{y}.png`

> Le script `install.sh` cree le dossier `/opt/theia/tiles/` mais ne telecharge
> pas de tuiles automatiquement (plusieurs Go possibles). Un script de
> telechargement dedie sera fourni separement.

## Compatibilite Tailscale

THEIA est accessible via Tailscale sans configuration supplementaire.
Recommandation pour eviter les conflits DNS :

```bash
sudo tailscale up --accept-dns=false
```

L'app sera alors accessible sur le reseau local (hotspot THEIA) ET via
l'adresse Tailscale (100.x.x.x).

## Stack technique

| Couche | Technologie |
|--------|------------|
| Frontend | Next.js 16, React 19, Tailwind CSS 4, shadcn/ui |
| Data fetching | SWR, fetch via `/api` routes |
| Carte | Leaflet + react-leaflet (dynamic, ssr:false) |
| Temps reel | SSE (Server-Sent Events) via EventSource |
| Backend | FastAPI, Uvicorn, Pydantic |
| Base de donnees | SQLite (fichier unique) |
| GPS | gpsd + gpsd-py3 |
| LoRa | pyserial (lecture trames serie) |
| Monitoring | psutil (CPU, RAM, disk, temperature) |
| Deploiement | systemd (2 services) |
| Preview | Vercel (mock data statique) |

## Troubleshooting

### `npm ERESOLVE unable to resolve dependency tree` (react-leaflet)

`react-leaflet@4.x` demande `react@^18` mais le projet utilise React 19.
Le fichier `.npmrc` a la racine contient `legacy-peer-deps=true` pour resoudre cela.

Si l'erreur persiste, verifier que le `.npmrc` est bien present :
```bash
cat ~/theia/.npmrc
# Doit afficher : legacy-peer-deps=true
```

Ou forcer manuellement :
```bash
cd /opt/theia/app
npm install --legacy-peer-deps
```

### `git pull` echoue "Your local changes would be overwritten"

```bash
cd ~/theia
git checkout -- .
git pull
sudo ./install.sh
```

### Un service ne demarre pas

```bash
# Voir les logs detailles
sudo journalctl -u theia-api -n 50 --no-pager
sudo journalctl -u theia-web -n 50 --no-pager

# Redemarrer manuellement
sudo systemctl restart theia-api
sudo systemctl restart theia-web
```

### Le GPS n'est pas detecte

```bash
# Verifier le device
ls -la /dev/ttyUSB*
# Tester gpsd
gpsmon
# Reconfigurer
sudo dpkg-reconfigure gpsd
```

### L'API ne repond pas sur /health

```bash
# Tester directement
curl -v http://localhost:8000/api/health

# Verifier que le port 8000 est ecoute
ss -tlnp | grep 8000
```

## Licence

Projet prive - Yo-ETE.
