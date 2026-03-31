# THEIA Hub Control - Documentation Complete

> **"La ou l'oeil est aveugle, l'onde revele"**

**Version 1.0** | (c) 2026 Yoann ETE | theiahub.contact@gmail.com

---

## Table des matieres

1. [Introduction](#introduction)
2. [Vue d'ensemble](#vue-densemble)
3. [Architecture technique](#architecture-technique)
4. [Capteurs supportes](#capteurs-supportes)
5. [Guide d'installation](#guide-dinstallation)
6. [Guide d'utilisation](#guide-dutilisation)
7. [Configuration avancee](#configuration-avancee)
8. [Troubleshooting](#troubleshooting)
9. [Roadmap](#roadmap)

---

## Introduction

### Qu'est-ce que THEIA ?

THEIA est un systeme de surveillance terrain complet base sur des capteurs radar LoRa. Il permet de detecter et localiser des presences humaines a travers les murs, dans l'obscurite totale, et dans des conditions ou les cameras traditionnelles sont inefficaces.

### Cas d'usage

- **Surveillance de batiments** : Detection d'intrusion, comptage de personnes
- **Operations tactiques** : Reconnaissance avant intervention, suivi de mouvements
- **Recherche et sauvetage** : Localisation de victimes dans les decombres
- **Domotique avancee** : Presence intelligente, automatisation
- **Etudes comportementales** : Analyse des flux, heatmaps d'activite

### Avantages cles

| Caracteristique | Description |
|-----------------|-------------|
| **Penetration** | Detection a travers murs, portes, cloisons |
| **Discretion** | Aucune emission visible, fonctionnement silencieux |
| **Autonomie** | Capteurs sur batterie, communication LoRa longue portee |
| **Temps reel** | Affichage instantane des detections |
| **Tout-en-un** | Webapp complete avec carte, heatmap, alertes |

---

## Vue d'ensemble

### Composants du systeme

```
+------------------+     LoRa 868MHz      +------------------+
|   Capteurs TX    | ------------------> |   Recepteur RX   |
|  (LD2450/C4001/  |                      |  (Heltec ESP32)  |
|   Gravity/XAVER) |                      +--------+---------+
+------------------+                               |
                                                   | USB
                                                   v
                                          +------------------+
                                          |  Raspberry Pi 5  |
                                          |                  |
                                          |  +------------+  |
                                          |  | FastAPI    |  |
                                          |  | (Backend)  |  |
                                          |  +------------+  |
                                          |  | Next.js    |  |
                                          |  | (Frontend) |  |
                                          |  +------------+  |
                                          +--------+---------+
                                                   |
                                              Wi-Fi/Ethernet
                                                   |
                                                   v
                                          +------------------+
                                          |  Navigateur Web  |
                                          |  (PC/Tablette)   |
                                          +------------------+
```

### Fonctionnalites principales

1. **Dashboard** - Monitoring systeme en temps reel
2. **Missions** - Gestion des operations de surveillance
3. **Carte interactive** - Visualisation des detections sur plan
4. **Heatmap** - Analyse des zones de passage
5. **Devices** - Provisioning et gestion des capteurs
6. **Alertes** - Notifications push, SMS, sonores
7. **Administration** - Configuration reseau, sauvegardes, mises a jour

---

## Architecture technique

### Stack technologique

| Couche | Technologie |
|--------|-------------|
| **Frontend** | Next.js 16, React 19, Tailwind CSS 4, shadcn/ui |
| **Backend** | FastAPI (Python), SQLite |
| **Communication** | LoRa 868MHz, SSE (Server-Sent Events) |
| **Cartographie** | Leaflet, react-leaflet |
| **Firmware** | Arduino ESP32 (Heltec WiFi LoRa V3) |
| **Deploiement** | Raspberry Pi 5, systemd |

### Ports et services

| Service | Port | Description |
|---------|------|-------------|
| Frontend (Next.js) | 3000 | Interface web |
| Backend (FastAPI) | 8000 | API REST + SSE |
| GPS (gpsd) | 2947 | Donnees GPS |

### Base de donnees

SQLite avec les tables suivantes :
- `users` - Comptes utilisateurs
- `missions` - Missions de surveillance
- `devices` - Capteurs enregistres
- `events` - Detections radar
- `logs` - Journaux applicatifs
- `notifications` - Alertes systeme
- `battery_logs` - Historique batterie
- `firmware_versions` - Versions des firmwares

---

## Capteurs supportes

### Tableau comparatif

| Capteur | Type | FOV | Portee | Multi-cibles | Vitesse | Particularite |
|---------|------|-----|--------|--------------|---------|---------------|
| **LD2450** | mmWave | 120° | 6m | Oui (3) | Oui | Position X/Y precise |
| **C4001** | mmWave | 60° | 8m | Non | Non | Profondeur uniquement |
| **Gravity MW V2** | Micro-ondes | 15-120° | 2-16m | Non | Non | Presence ON/OFF |
| **XAVER 400** | Through-wall | 120° | 8m | Oui | Non | Penetration murs epais |

### LD2450 (HLK-LD2450)

Le capteur principal pour la localisation precise.

**Caracteristiques :**
- Detection multi-cibles (jusqu'a 3 personnes)
- Position X/Y en centimetres
- Vitesse de deplacement
- Ideal pour le tracking de mouvements

**Format de trame :**
```
LD45;TX01;x;y;d;v;battV
     |    | | | |   |
     |    | | | |   +-- Tension batterie (V)
     |    | | | +------ Vitesse (cm/s)
     |    | | +-------- Distance (cm)
     |    | +---------- Position Y (cm)
     |    +------------ Position X (cm)
     +----------------- ID du capteur
```

### C4001 (DFRobot Gravity)

Capteur economique pour detection de passage.

**Caracteristiques :**
- Mesure de distance uniquement (depth)
- FOV etroit (60°) = moins de faux positifs
- Detection de direction (entree/sortie)
- Seuils adaptatifs

### Gravity MW V2 (SEN0192)

Capteur de presence simple et fiable.

**Caracteristiques :**
- Detection ON/OFF uniquement
- Portee et FOV configurables via la webapp
- Presets de penetration selon le materiau du mur
- Tres faible consommation

**Presets de surface :**
| Surface | Portee | FOV |
|---------|--------|-----|
| Libre (air) | 16m | 120° |
| PVC/Plastique | 14m | 110° |
| Porte bois | 12m | 100° |
| Platre/BA13 | 10m | 90° |
| Parpaing | 8m | 80° |
| Beton leger | 6m | 70° |
| Beton arme | 4m | 60° |

### XAVER 400 (Camero)

Radar militaire through-wall professionnel.

**Caracteristiques :**
- Penetration murs epais (beton, metal)
- Sortie video BNC capturee par script Python
- Analyse colorimetrique pour detection des cibles
- Multi-cibles avec filtre de persistance

---

## Guide d'installation

### Prerequis

- Raspberry Pi 5 (ou 4) avec Raspberry Pi OS (Bookworm 64-bit)
- Acces internet pour l'installation initiale
- Recepteur LoRa Heltec (branche USB)
- (Optionnel) GPS USB
- (Optionnel) Capteurs TX a flasher

### Installation automatique

```bash
# 1. Cloner le depot
cd ~
git clone https://github.com/Yo-ETE/theia.git theia
cd theia

# 2. Lancer l'installation
chmod +x install.sh
sudo bash install.sh
```

Le script est **idempotent** : relancez-le autant de fois que necessaire.

### Etapes d'installation

| Etape | Description |
|-------|-------------|
| 1 | Mise a jour systeme + dependances |
| 2 | Installation arduino-cli + ESP32 |
| 3 | Installation Node.js 20.x |
| 4 | Creation des repertoires |
| 5 | Copie des fichiers |
| 6 | Configuration Python venv |
| 7 | Build Next.js |
| 8 | Configuration gpsd |
| 9 | Regles udev |
| 10 | Services systemd |

### Verification

```bash
# Status des services
sudo systemctl status theia-api theia-web

# Logs en temps reel
sudo journalctl -u theia-api -f

# Test API
curl http://localhost:8000/api/health
```

---

## Guide d'utilisation

### Premiere connexion

1. Ouvrir `http://IP_DU_PI:3000` dans un navigateur
2. Se connecter avec `admin` / `admin`
3. **Changer immediatement le mot de passe** dans Administration

### Creer une mission

1. Aller dans **Missions** > **Nouvelle mission**
2. Remplir le formulaire :
   - Nom de la mission
   - Type de site (Habitation, Batiment, Terrain...)
   - Position GPS (automatique ou manuelle)
3. Ajouter un plan de batiment (optionnel)
4. Dessiner les zones de surveillance
5. Assigner les capteurs aux zones

### Provisionner un capteur

1. Brancher l'ESP32 en USB sur le Pi
2. Aller dans **Devices** > **Nouveau capteur**
3. Configurer :
   - TX_ID (ex: TX01)
   - Type de capteur
   - Firmware template
   - Port USB
4. Cliquer **Compiler & Flash**
5. Le device est enregistre automatiquement

### Assigner un capteur a une mission

1. Ouvrir la mission
2. Dans le panneau droit, cliquer **Assign Device**
3. Selectionner le capteur
4. Cliquer sur la carte pour placer le capteur
5. Ajuster l'orientation si necessaire
6. Pour Gravity MW V2 : configurer le preset de surface

### Lire les detections

- **Point vert** : Position detectee
- **Ligne pointillee** : Trajectoire
- **Cone colore** : Champ de vision du capteur
- **Heatmap** : Densite des passages

### Alertes et notifications

**Types d'alertes :**
- Batterie faible (< 3.5V)
- Signal RSSI faible (< -90dBm)
- Device offline (> 120s sans signal)

**Canaux de notification :**
- Cloche dans la webapp
- Son de detection (ping radar)
- Push notification (PWA)
- SMS (Free Mobile, Twilio, ntfy.sh)

---

## Configuration avancee

### Variables d'environnement

Fichier `/opt/theia/app/.env` :

```bash
# Mode
NEXT_PUBLIC_MODE=pi

# Authentification
JWT_SECRET=xxxx

# GPS
GPS_DEVICE=/dev/theia-gps

# LoRa
LORA_SERIAL_PORT=/dev/theia-rx
LORA_BAUD_RATE=115200

# Carte
MAP_MODE=online

# Retention (jours)
RETENTION_EVENTS_DAYS=90
RETENTION_LOGS_DAYS=30
```

### Configuration Wi-Fi

1. Administration > Configuration Wi-Fi
2. Scanner les reseaux disponibles
3. Se connecter au reseau souhaite
4. Ou ajouter un reseau cache manuellement

### Tailscale VPN

Pour acces distant securise :

1. Administration > Tailscale
2. Activer Tailscale
3. Authentifier avec le lien fourni
4. Acceder via `http://100.x.x.x:3000`

### Sauvegardes

1. Administration > Sauvegardes
2. Cliquer **Creer une sauvegarde**
3. Telecharger le fichier .tar.gz
4. Pour restaurer : uploader la sauvegarde

---

## Troubleshooting

### Le capteur n'envoie pas de donnees

1. Verifier la batterie (> 3.3V)
2. Verifier que le RX est branche et detecte
3. Verifier les logs : `journalctl -u theia-api -f`
4. Reflasher le capteur si necessaire

### Flash ESP32 echoue

1. Mettre en mode bootloader :
   - Maintenir USER/BOOT enfonce
   - Brancher USB
   - Relacher apres 2s
2. Relancer le flash

### GPS non detecte

```bash
ls -la /dev/theia-gps
gpsmon
sudo dpkg-reconfigure gpsd
```

### Mot de passe oublie

```bash
sudo /opt/theia/.venv/bin/python3 -c "
import sqlite3, hashlib, os
db = sqlite3.connect('/opt/theia/data/theia.db')
salt = os.urandom(32).hex()
pw = hashlib.pbkdf2_hmac('sha256', b'admin', bytes.fromhex(salt), 100000).hex()
db.execute('UPDATE users SET password_hash=?, salt=? WHERE username=?', (pw, salt, 'admin'))
db.commit(); print('Password reset to: admin')
"
```

---

## Roadmap

### Version 1.1 (prevue)

- [ ] Support multi-etages (affichage simultane)
- [ ] Triangulation multi-capteurs
- [ ] Auto-detection des pieces
- [ ] Timeline interactive

### Version 1.2 (planifiee)

- [ ] Intelligence analytique (trajectoires, predictions)
- [ ] Alertes comportementales (chute, immobilite)
- [ ] Vue 3D isometrique
- [ ] Export rapports PDF

### Version 2.0 (future)

- [ ] Fusion sensorielle avancee
- [ ] Machine learning pour detection d'anomalies
- [ ] Integration domotique (Home Assistant)
- [ ] Mode cloud (multi-sites)

---

## Support

**Contact :** theiahub.contact@gmail.com

**Documentation :** https://github.com/Yo-ETE/theia

---

*THEIA Hub Control v1.0 - (c) 2026 Yoann ETE - Tous droits reserves*
