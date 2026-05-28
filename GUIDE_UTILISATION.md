# Guide d'Utilisation THEIA Hub Control

> **"La ou l'oeil est aveugle, l'onde revele"**

Ce guide vous accompagne dans l'utilisation quotidienne de THEIA Hub Control.

---

## Table des matieres

1. [Premiere connexion](#premiere-connexion)
2. [Dashboard](#dashboard)
3. [Missions](#missions)
4. [Capteurs (Devices)](#capteurs-devices)
5. [Logs](#logs)
6. [Administration](#administration)
7. [Gestion des utilisateurs et permissions](#gestion-des-utilisateurs-et-permissions)
8. [Notifications](#notifications)
9. [FAQ / Depannage](#faq--depannage)

---

## Premiere connexion

### Identifiants par defaut

- **Utilisateur** : `admin`
- **Mot de passe** : `admin`

> **Important** : Changez ce mot de passe immediatement apres la premiere connexion via Administration > Comptes utilisateurs.

### Acces distant via Tailscale

Pour acceder a THEIA depuis l'exterieur du reseau local :
1. Installez Tailscale sur votre appareil
2. Rejoignez le meme reseau Tailscale que le Raspberry Pi
3. Accedez via l'adresse Tailscale : `http://100.x.x.x:3000`

---

## Dashboard

Le dashboard affiche l'etat en temps reel du hub THEIA.

### Indicateurs systeme
- **CPU** : Utilisation processeur (%)
- **RAM** : Memoire utilisee / totale
- **Disque** : Espace disque utilise
- **Temperature** : Temperature du CPU (Raspberry Pi)

### Connectivite
- **Wi-Fi** : SSID, signal, debit
- **Ethernet** : IP, etat
- **GPS** : Fix, coordonnees, satellites
- **LoRa RX** : Etat du recepteur, RSSI, paquets

### Alertes actives
- Batterie faible (< 3.5V) ou critique (< 3.3V)
- Signal RSSI faible (< -90dBm)
- Device offline (pas de signal depuis > 120s)

### Graphique batterie
Visualisez la consommation batterie des capteurs sur 1h, 6h, 24h ou 7 jours.

---

## Missions

### Creer une mission

1. Cliquez sur **+ Nouvelle mission**
2. Remplissez les informations :
   - **Nom** : Identifiant de la mission
   - **Type de site** : Habitation, Batiment industriel, Terrain, Vehicule, Autre
   - **Adresse** (optionnel) : Pour geolocalisation automatique
3. Cliquez **Creer**

### Configurer les zones de detection

1. Ouvrez une mission en mode **DRAFT**
2. Cliquez sur **Draw Zone** pour dessiner une zone polygonale
3. Nommez la zone et selectionnez son type :
   - Facade/Wall, Perimeter, Interior, Roof, Floor/Etage, Section, Custom
4. Labellisez les faces (A, B, C, D) pour l'affichage des detections

### Assigner des capteurs

1. Dans la section **Assigned Devices**, cliquez **+**
2. Selectionnez un capteur disponible
3. Choisissez la **zone** et la **face** d'assignation
4. Le capteur apparait sur la carte avec son FOV (champ de vision)

### Controler une mission

| Bouton | Action |
|--------|--------|
| **Resume** | Demarrer/reprendre la surveillance |
| **Pause** | Mettre en pause (les capteurs restent actifs) |
| **Stop** | Arreter et archiver la mission |

### Mode multi-etages

Si votre site a plusieurs etages :
1. Creez des zones avec des etages differents (RDC, 1er, 2eme...)
2. Utilisez le selecteur d'etage pour filtrer l'affichage
3. Activez le **basculement auto** pour suivre les detections entre etages

### Onglets de la mission

| Onglet | Description |
|--------|-------------|
| **Live** | Detections en temps reel + FOV + Detection Feed |
| **History** | Historique des evenements + timeline + heatmap |
| **Sensors** | Vue detaillee des capteurs assignes |
| **Timelapse** | Replay des detections sur une periode |

### Detection Feed (Live)

Le feed de detection affiche les evenements en temps reel :
- **TTL 5 minutes** : Apres 5 min sans detection, seule la derniere est conservee
- **Filtrage par etage** : Seules les detections de l'etage selectionne sont affichees
- **Filtrage par capteur** : Utilisez le menu deroulant pour filtrer par TX

### Export des donnees

- **Export CSV** : Telechargez l'historique des evenements
- **Heatmap** : Visualisez la densite des detections par zone

---

## Capteurs (Devices)

### Types de capteurs supportes

| Type | Modele | Caracteristiques |
|------|--------|------------------|
| **LD2450** | HLK-LD2450 | Radar mmWave, position X/Y, vitesse, 3 cibles, FOV 120° |
| **C4001** | DFRobot C4001 | Radar mmWave, distance uniquement, FOV 60° |
| **Gravity MW V2** | SEN0192 | Micro-ondes, presence ON/OFF, portee configurable |
| **XAVER 400** | Camero | Radar through-wall, capture BNC |

### Flasher un capteur (Provisioning)

1. Branchez l'ESP32 en USB sur le Raspberry Pi
2. Allez dans **Devices** > **Nouveau capteur**
3. Entrez le **TX_ID** (ex: TX03)
4. Selectionnez le **type** et le **firmware**
5. Selectionnez le **port USB**
6. Cliquez **Compiler & Flash**
7. Suivez la progression dans la console

### Enrollement manuel

Pour un capteur deja flashe :
1. Cliquez **Enroller manuellement**
2. Entrez le TX_ID exact
3. Selectionnez le type de capteur
4. Le device apparait dans la liste

### Monitoring des capteurs

Pour chaque capteur, vous voyez :
- **RSSI** : Signal LoRa (dBm)
- **Batterie** : Tension (V)
- **Derniere detection** : Timestamp
- **Zone assignee** : Mission/zone actuelle

### Actions sur un capteur

| Action | Description |
|--------|-------------|
| **Assigner** | Affecter a une mission/zone |
| **Retirer** | Desassigner de la mission |
| **Mute** | Masquer du Detection Feed (reste actif) |
| **Supprimer** | Retirer de la base de donnees |

---

## Logs

### Types de logs

| Source | Description |
|--------|-------------|
| **Application** | Logs THEIA (frontend + backend) |
| **Systeme** | Logs journalctl du Raspberry Pi |
| **Devices** | Connexions, deconnexions, alertes capteurs |

### Filtres disponibles

- **Niveau** : DEBUG, INFO, WARNING, ERROR
- **Source** : api, web, lora, gps, system
- **Recherche** : Texte libre
- **Periode** : Derniere heure, 24h, 7j, tout

### Export

Cliquez sur **Export** pour telecharger les logs filtres au format CSV.

---

## Administration

> Accessible uniquement aux utilisateurs avec le role **admin** ou la permission **administration**.

### Comptes utilisateurs

Gerez les comptes et permissions (voir section dediee ci-dessous).

### Configuration reseau

- **Wi-Fi** : Scanner, connecter, gerer les reseaux sauvegardes
- **Ethernet** : Voir l'adresse IP
- **Tailscale** : Up/Down, exit node, voir les peers

### Sauvegardes

- **Creer** : Sauvegarde complete (base + configs)
- **Restaurer** : Revenir a un etat precedent
- **Supprimer** : Nettoyer les anciennes sauvegardes

### Mise a jour

1. Selectionnez la branche Git (main, develop...)
2. Cliquez **Mettre a jour**
3. Suivez la progression en temps reel
4. Le systeme redemarrera automatiquement si necessaire

### Retention des donnees

Configurez la purge automatique :
- **Events** : 90 jours par defaut
- **Logs** : 30 jours par defaut
- **Batterie** : 60 jours par defaut

### Configuration SMS/Notifications

Configurez les alertes SMS via :
- **Free Mobile** : API Free
- **Twilio** : Service SMS international
- **ntfy.sh** : Notifications push open-source

---

## Gestion des utilisateurs et permissions

### Roles

| Role | Description |
|------|-------------|
| **Admin** | Acces complet a toutes les fonctionnalites |
| **Viewer** | Permissions personnalisables |

### Presets de permissions

| Preset | Description |
|--------|-------------|
| **Administrateur** | Acces complet |
| **Operateur** | Gestion missions/capteurs, sans admin systeme |
| **Visualisateur** | Lecture seule : dashboard et missions |

### Permissions detaillees

#### Pages
- Dashboard, Missions, Capteurs, Logs, Administration

#### Missions
- Creer, Modifier, Supprimer, Controler (Start/Pause/Stop)

#### Capteurs
- Assigner, Retirer, Flasher, Enroller, Supprimer

#### Systeme
- Sauvegardes, Mise a jour Git, Redemarrer/Arreter

### Creer un compte avec permissions personnalisees

1. Allez dans **Administration** > **Comptes utilisateurs**
2. Cliquez **+ Nouveau**
3. Entrez identifiant et mot de passe
4. Selectionnez **Visualisateur** comme role
5. Cliquez sur **Permissions** pour personnaliser
6. Cochez/decochez les permissions souhaitees
7. Cliquez **Creer**

### Modifier les permissions d'un utilisateur existant

1. Trouvez l'utilisateur dans la liste
2. Cliquez sur l'icone **engrenage** (Settings)
3. Modifiez les permissions
4. Cliquez **Enregistrer**

---

## Notifications

### Cloche (sidebar)

Notifications systeme globales :
- Batterie critique/faible
- Signal RSSI faible
- Device offline/reconnecte

**Anti-spam** : 1 notification par type/device par heure.

### Son de detection

Dans une mission :
1. Cliquez sur l'icone **Volume** pour activer/desactiver
2. Un ping radar synthetique retentit a chaque detection
3. **Throttle** : Maximum 1 son toutes les 2 secondes

### Notifications Push

Configuration par mission :
1. Ouvrez les parametres de la mission
2. Activez **Web Push** et/ou **SMS**
3. Configurez le cooldown et les zones filtrees

**iPhone** : Ajoutez THEIA a l'ecran d'accueil pour recevoir les notifications.

---

## FAQ / Depannage

### Le capteur n'envoie pas de donnees

1. Verifiez que le capteur est sous tension (LED)
2. Verifiez le RSSI dans la liste des devices
3. Rapprochez le capteur du recepteur RX
4. Verifiez que le RX est bien connecte (`/dev/theia-rx`)

### Le GPS n'a pas de fix

1. Placez le recepteur GPS pres d'une fenetre
2. Attendez 2-3 minutes pour l'acquisition
3. Verifiez avec `gpsmon` en SSH

### Je ne recois pas les notifications push

1. Autorisez les notifications dans votre navigateur
2. Sur iPhone : ajoutez THEIA a l'ecran d'accueil
3. Verifiez la configuration dans les parametres de mission

### Mot de passe admin oublie

En SSH sur le Raspberry Pi :
```bash
sudo /opt/theia/.venv/bin/python3 -c "
import sqlite3, hashlib, os
db = sqlite3.connect('/opt/theia/data/theia.db')
salt = os.urandom(32).hex()
pw = hashlib.pbkdf2_hmac('sha256', b'admin', bytes.fromhex(salt), 100000).hex()
db.execute('UPDATE users SET password_hash=?, salt=? WHERE username=?', (pw, salt, 'admin'))
db.commit(); print('Password reset to: admin')
"
sudo systemctl restart theia-api
```

### La carte ne s'affiche pas

1. Verifiez la connexion internet (mode online)
2. En mode offline, verifiez que les tuiles sont presentes dans `/opt/theia/tiles`

### Le flash du capteur echoue

Pour ESP32-S3 :
1. Maintenez le bouton **USER/BOOT** enfonce
2. Branchez le cable USB
3. Attendez 2 secondes puis relachez
4. Lancez l'upload immediatement

---

## Support

Pour toute question ou probleme :
- Email : theiahub.contact@gmail.com
- GitHub Issues : [github.com/Yo-ETE/theia/issues](https://github.com/Yo-ETE/theia/issues)

---

**THEIA Hub Control v1.0** - (c) 2026 Yoann ETE
