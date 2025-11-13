<div align="center">

# PureBlock
**L'extension open-source légère qui libère des pubs de merde**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge&logo=opensourceinitiative)](https://github.com/henissartj/PureBlock/blob/main/LICENSE)  
[![Last Commit](https://img.shields.io/github/last-commit/henissartj/PureBlock?style=for-the-badge&color=success)](https://github.com/henissartj/PureBlock/commits/main)  

</div>

<div align="center">
  <img src="icons/images/top.png" alt="Interface PureBlock" width="600"/>
  <br><br>
</div>

---

## 🌟 **Description**

**PureBlock** est une **extension open-source ultra-légère et ultra-sécurisée** conçue pour **bloquer efficacement toutes les publicités sur YouTube** — sans compromis sur la vitesse ou la qualité.

Avec un contrôle fin et intelligent, elle vous redonne la main :  
✅ Désactivez-la sur un site en un clic  
✅ Choisissez votre User-Agent  
✅ Profitez du **1080p Premium** sans abonnement

## 📥 **Installation (2 minutes)**

1. Clonez ou téléchargez le dépôt
```
   git clone https://github.com/henissartj/PureBlock.git
```

2. Ouvrez votre navigateur :

   • Chrome : chrome://extensions → "Mode développeur" → "Charger l'extension non empaquetée"
   
   • Firefox : about:debugging#/runtime/this-firefox → "Charger un module complémentaire temporaire"

3. Sélectionnez le dossier `PureBlock`

---

## 🚀 **Bitrate & Qualité Vidéo**

PureBlock intègre un ensemble d’optimisations pensées pour obtenir une lecture super fluide, stable et premium — sans tricher sur les métriques du player.

### 🔧 Fonctionnalités principales
- Bitrate Booster: maintient automatiquement la meilleure qualité disponible (2160p/1440p/1080p), résistant aux retours en "auto".
- Préférer HDR: privilégie les pistes HDR (HLG/PQ/VP9.2/AV1 HDR) quand disponibles.
- Préférence codec (YouTube): choisissez `AV1`, `VP9`, ou `H.264` selon votre matériel et vos priorités.
- Anti‑bursts réseau: limite la concurrence des segments et pace le flux vidéo pour un débit régulier.
- Buffer intelligent: précharge minimal (`preload='metadata'`) et avance contrôlée (ex. ~20 s max).

### 🧠 Comment ça marche
- Tri doux des formats côté player: sans supprimer de formats, PureBlock réordonne les pistes (résolution, 60 fps, HDR, codec préféré) pour influencer la sélection initiale.
- Gardien de qualité: réapplique la meilleure qualité au fil de la navigation et des changements internes du player.
- Réseau ultra propre:
  - Queue de concurrence (1 flux vidéo à la fois) pour supprimer les bursts.
  - Throttle via `ReadableStream` uniquement sur la vidéo; l’audio n’est pas ralenti pour des démarrages instantanés.
  - Débits par défaut: ~5 Mbps pour HD/1080p et ~12 Mbps pour 4K (ajustables en code).
  - Respect total des en‑têtes (`status`, `statusText`, `headers`) et des timings; aucune falsification des métriques.

### 🎛️ Utilisation
- Ouvrez la page Options de l’extension et configurez:
  - `Booster bitrate (players génériques)` → ON pour activer le gardien de qualité.
  - `Préférer HDR` → ON pour favoriser les pistes HDR (quand présentes).
  - `Préférence codec (YouTube)` → `Auto`, `AV1`, `VP9`, ou `H.264`.

### 🎯 Choisir le bon codec
- `AV1`: qualité supérieure et efficacité, idéal sur GPU/CPU modernes. Peut être plus exigeant.
- `VP9`: bon compromis qualité/perf; très stable sur la majorité des machines.
- `H.264`: très fluide sur matériel plus ancien; parfait pour réduire les frames dropped à 1080p60.

### 🌈 HDR
- Si activé et disponible, PureBlock tentera de retenir une piste HDR (VP9.2 / AV1 HDR). En l’absence d’HDR, la meilleure piste SDR est choisie.

### 📈 Metrics propres (Stats for nerds)
- Aucun patch de `performance.now`, `navigator.connection`, `HTMLVideoElement.buffered` ou des objets lus par le player.
- Le pacing réseau n’altère pas les statuts/headers; les timings reflètent le réseau réel.
- Une annotation légère s’affiche dans le panneau: `PureBlock Bitrate Booster: ON/OFF · HDR: ON/OFF · Codec: AUTO/AV1/VP9/H264`.

### 🧪 Tests rapides
- 1080p60: vérifier que `Network Activity` est lissée (~5 Mbps par défaut) avec peu ou pas de bursts; `Buffer Health` reste stable.
- 4K: débit régulier (~12 Mbps par défaut), fluidité sans débordement de buffer.
- Changez de codec dans Options et observez la ligne `Codecs` des Stats (`av01`, `vp09`, `avc1`).

### ⚙️ Réglages avancés (développeurs)
- Variables dans `youtube.js`:
  - `gvMaxConcurrent` (par défaut `1`): concurrence segments vidéo.
  - `gvThrottleMbps` (par défaut `5`): débit vidéo pour HD.
  - `gvMbps4K` (par défaut `12`): débit vidéo pour 4K.
  - `prebufferSeconds` (par défaut `20`): avance buffer maximale.
- Ces valeurs peuvent être exposées en UI si nécessaire; aujourd’hui elles sont fixées pour une expérience stable.

### 🛠️ Compatibilité et limites
- Le throttle s’applique aux URLs `googlevideo.com/videoplayback` et uniquement aux réponses vidéo (audio bypass).
- Si le réseau est très fluctuant, augmenter légèrement le débit cible peut aider (ex. 8 Mbps HD, 18 Mbps 4K).
- L’HDR dépend des disponibilités par vidéo et du support navigateur.

### 🔒 Respect et confidentialité
- PureBlock n’envoie aucune donnée au Mossad et à la DGSI #boycott ces fils de pute
- Les règles de blocage publicitaires et les optimisations s’exécutent localement.

### 💡 Recommandations
- Matériel récent: `AV1` + Bitrate Booster + HDR si disponible.
- Matériel intermédiaire: `VP9` + Bitrate Booster.
- Matériel ancien ou CPU limité: `H.264` + 1080p60 pour une fluidité optimale.

---

## 🙌 Remerciements

- La fonctionnalité d’anti‑Shorts YouTube a été proposée par Mattis. Merci pour l’idée et les coups de fouets qui m'ont aidés à travailler. Il m'a dit de me sortir les doigts puis m'a mit les siens.
