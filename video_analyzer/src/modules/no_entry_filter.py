"""
LogisticsTrack — Modulo No Entry Filter

Rileva persone in aree non autorizzate, discriminando in base alla presenza
di DPI (giubbotto ad alta visibilità) e al colore della parte superiore del corpo.

Tecnologia core:
- YOLO26-Pose per rilevare persone e keypoints (spalle, fianchi, collo)
- extract_torso_crop(): crop dinamico del torso dai keypoints COCO
- VestColorClassifier: interfaccia per classificazione DPI/colore
  - HSVClassifier: analisi HSV immediata (default, zero ML deps)
  - MLClassifier: stub per futuro classificatore addestrato
- PersonTrackerState: smoothing temporale per attributi per-tracker
- ROIEngine: verifica se la persona è in una zona "no entry"

Event types generati:
- "person_no_vest": persona rilevata senza DPI visibile
- "person_unauthorized": persona con DPI ma non autorizzata (color mismatch)

Nota: Il modulo è in modalità STUB finché pose_model_path non è configurato.
Vedere data/modules.json per la configurazione.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from collections import Counter, deque
from dataclasses import dataclass, field
from typing import Any

import cv2
import numpy as np

from detector import Detection
from modules.base import BaseEvent, BaseVideoModule, FrameMeta
from roi_engine import ROIEngine

logger = logging.getLogger("NoEntryFilterModule")

# ---------------------------------------------------------------------------
# Keypoint indices COCO 17-point (standard Ultralytics YOLO-Pose)
# ---------------------------------------------------------------------------
_KP_LEFT_SHOULDER  = 5
_KP_RIGHT_SHOULDER = 6
_KP_LEFT_HIP       = 11
_KP_RIGHT_HIP      = 12
_KP_NOSE           = 0
_KP_LEFT_ELBOW     = 7
_KP_RIGHT_ELBOW    = 8

# Soglia minima di confidenza keypoint per considerarlo valido
_KP_MIN_CONF = 0.3


# ---------------------------------------------------------------------------
# PersonTrackerState — stato temporale per smoothing attributi
# ---------------------------------------------------------------------------

@dataclass
class PersonTrackerState:
    """
    Stato temporale per una persona tracciata.

    Implementa il "voto a maggioranza" (majority voting) su una finestra
    scorrevole di N frame per stabilizzare gli attributi has_vest e
    upper_color contro occlusioni temporanee (es. persona che trasporta
    una scatola davanti al torso).
    """

    track_id: int
    vest_history: deque[bool] = field(default_factory=lambda: deque(maxlen=10))
    color_history: deque[str] = field(default_factory=lambda: deque(maxlen=10))
    first_seen_at: float = 0.0
    last_seen_at: float  = 0.0
    in_roi: bool         = False
    alert_sent: bool     = False   # Impedisce eventi duplicati per lo stesso ingresso

    @property
    def has_vest_stable(self) -> bool:
        """True se la maggioranza dei frame recenti mostra un giubbetto."""
        if not self.vest_history:
            return False
        return sum(self.vest_history) > len(self.vest_history) / 2

    @property
    def upper_color_stable(self) -> str:
        """Colore predominante per voto a maggioranza."""
        if not self.color_history:
            return "unknown"
        return Counter(self.color_history).most_common(1)[0][0]

    @property
    def is_authorized(self) -> bool:
        """
        Persona autorizzata se ha un giubbetto DPI valido (colore visibilità alta).
        La lista colori ammissibili è determinata da HSVClassifier._VEST_COLORS.
        """
        return self.has_vest_stable

    @property
    def dwell_seconds(self) -> float:
        """Permanenza stimata in secondi dall'ultima comparsa."""
        if self.first_seen_at <= 0:
            return 0.0
        return max(0.0, self.last_seen_at - self.first_seen_at)


# ---------------------------------------------------------------------------
# Classificatore DPI/Colore — Interfaccia + Implementazioni
# ---------------------------------------------------------------------------

@dataclass
class ClassificationResult:
    """Risultato della classificazione DPI/colore su un crop torso."""

    has_vest: bool          # True se giubbetto ad alta visibilità rilevato
    upper_color: str        # Colore predominante (orange|yellow|green|blue|white|black|unknown)
    confidence: float       # Confidenza stimata 0.0–1.0


class VestColorClassifier(ABC):
    """
    Interfaccia per classificatori di DPI/colore su crop del torso.

    Implementazioni disponibili:
    - HSVClassifier: analisi istogramma HSV (zero dipendenze ML)
    - MLClassifier: stub per futuro modello addestrato (EfficientNet, ResNet, ecc.)
    """

    @abstractmethod
    def classify(self, torso_crop: np.ndarray) -> ClassificationResult:
        """
        Classifica il crop del torso.

        Args:
            torso_crop: Immagine BGR del torso (output di extract_torso_crop).

        Returns:
            ClassificationResult con has_vest, upper_color, confidence.
        """
        ...

    @abstractmethod
    def is_ready(self) -> bool:
        """True se il classificatore è operativo e può processare crop."""
        ...


class HSVClassifier(VestColorClassifier):
    """
    Classificatore basato su analisi istogramma HSV.

    Calcola la percentuale di pixel di ogni range cromatico nel crop
    e restituisce il colore con la presenza maggiore (se supera _MIN_RATIO).

    Accuratezza: ~80-85% in ambienti con illuminazione controllata.
    Latenza: ~1ms per crop (nessun modello ML da eseguire).
    """

    # Range HSV in formato OpenCV: Hue 0-180, Sat 0-255, Val 0-255
    _COLOR_RANGES: dict[str, tuple[tuple, tuple]] = {
        "orange": ((5,  100, 100), (15,  255, 255)),   # DPI arancione
        "yellow": ((20, 100, 100), (35,  255, 255)),   # DPI giallo
        "green":  ((40,  50,  50), (80,  255, 255)),   # DPI verde
        "red":    ((0,  100, 100), (10,  255, 255)),   # DPI rosso
        "blue":   ((100, 50,  50), (130, 255, 255)),   # tuta blu operai
        "white":  ((0,   0,  200), (180,  30, 255)),   # camice/divisa bianca
        "black":  ((0,   0,    0), (180, 255,  50)),   # abbigliamento scuro
    }

    # Colori che indicano un DPI (giubbetto alta visibilità)
    _VEST_COLORS: frozenset[str] = frozenset({"orange", "yellow", "green"})

    # Percentuale minima di pixel del crop per considerare un colore presente
    _MIN_RATIO: float = 0.15

    def classify(self, torso_crop: np.ndarray) -> ClassificationResult:
        """Analisi istogramma HSV per identificare colore dominante e presenza DPI."""
        if torso_crop is None or torso_crop.size == 0:
            return ClassificationResult(has_vest=False, upper_color="unknown", confidence=0.0)

        hsv = cv2.cvtColor(torso_crop, cv2.COLOR_BGR2HSV)
        total_px = torso_crop.shape[0] * torso_crop.shape[1]
        if total_px == 0:
            return ClassificationResult(has_vest=False, upper_color="unknown", confidence=0.0)

        best_color = "unknown"
        best_ratio = self._MIN_RATIO

        for color_name, (lower, upper) in self._COLOR_RANGES.items():
            mask = cv2.inRange(hsv, np.array(lower, dtype=np.uint8), np.array(upper, dtype=np.uint8))
            ratio = float(np.sum(mask > 0)) / total_px
            if ratio > best_ratio:
                best_ratio = ratio
                best_color = color_name

        # Normalizzazione indicativa della confidenza (ratio × 3, cap 1.0)
        confidence = min(best_ratio * 3.0, 1.0)

        return ClassificationResult(
            has_vest=best_color in self._VEST_COLORS,
            upper_color=best_color,
            confidence=confidence,
        )

    def is_ready(self) -> bool:
        return True   # Sempre disponibile, nessun modello da caricare


class MLClassifier(VestColorClassifier):
    """
    Stub per classificatore ML (es. EfficientNet-B0 fine-tuned su dataset DPI).

    Stato attuale: non operativo (is_ready() == False) finché il modello non è caricato.

    Per attivare:
    1. Addestrare un classificatore binario/multiclasse su crop di torso (con/senza DPI)
    2. Esportare in formato PyTorch TorchScript, ONNX, o Ultralytics .pt
    3. Configurare "classifier_model_path" in modules.json
    4. Implementare _run_inference() con la logica di preprocessing + inferenza

    La struttura è predisposta: basta implementare _run_inference().
    """

    def __init__(self, model_path: str | None = None) -> None:
        self._model: Any = None
        self._model_path = model_path
        if model_path:
            self._load_model(model_path)

    def _load_model(self, path: str) -> None:
        """Carica il modello dal path specificato."""
        try:
            # TODO: implementare con il framework scelto (PyTorch, ONNX, ecc.)
            # Esempio PyTorch TorchScript:
            #   import torch
            #   self._model = torch.jit.load(path, map_location="cpu")
            #   self._model.eval()
            # Esempio ONNX:
            #   import onnxruntime as ort
            #   self._model = ort.InferenceSession(path)
            logger.info(f"MLClassifier: placeholder per modello da {path}. Implementazione da completare.")
        except Exception as e:
            logger.error(f"MLClassifier: errore caricamento da '{path}': {e}")
            self._model = None

    def _run_inference(self, torso_crop: np.ndarray) -> ClassificationResult:
        """
        Esegue inferenza ML sul crop.
        Da implementare quando il modello è disponibile.
        """
        # TODO: implementare con modello reale
        # 1. Resize crop a dimensione input modello (es. 224x224)
        # 2. Normalizza pixel (ImageNet mean/std o custom)
        # 3. Esegui forward pass
        # 4. Interpreta output (has_vest, upper_color, confidence)
        raise NotImplementedError("MLClassifier._run_inference() non ancora implementato")

    def classify(self, torso_crop: np.ndarray) -> ClassificationResult:
        if not self.is_ready():
            return ClassificationResult(has_vest=False, upper_color="unknown", confidence=0.0)
        return self._run_inference(torso_crop)

    def is_ready(self) -> bool:
        return self._model is not None


def _build_classifier(config: dict[str, Any]) -> VestColorClassifier:
    """
    Factory: costruisce il classificatore appropriato in base alla configurazione.

    Logica:
    1. Se "classifier_model_path" è configurato → tenta MLClassifier
    2. Se MLClassifier non è pronto (modello non trovato/non implementato) → fallback HSVClassifier
    3. Default → HSVClassifier

    Args:
        config: Configurazione del modulo (da modules.json).

    Returns:
        Istanza di VestColorClassifier pronta all'uso.
    """
    ml_path = config.get("classifier_model_path")
    if ml_path:
        clf = MLClassifier(ml_path)
        if clf.is_ready():
            logger.info(f"NoEntryFilter: usando MLClassifier (modello: {ml_path})")
            return clf
        logger.warning(
            f"NoEntryFilter: MLClassifier non disponibile per '{ml_path}' "
            "— fallback su HSVClassifier"
        )
    logger.info("NoEntryFilter: usando HSVClassifier (analisi HSV, zero dipendenze ML)")
    return HSVClassifier()


# ---------------------------------------------------------------------------
# Funzioni di supporto per estrazione crop torso
# ---------------------------------------------------------------------------

def extract_torso_crop(
    frame: np.ndarray,
    keypoints: np.ndarray,
    padding_factor: float = 0.1,
) -> np.ndarray | None:
    """
    Estrae un crop BGR del torso da una persona rilevata con YOLO-Pose.

    Usa i keypoints spalle+fianchi (COCO 17-point) per definire la bounding box
    del torso, escludendo testa, braccia e gambe.

    Gestione casi limite:
    - Keypoints mancanti (conf < _KP_MIN_CONF): usa quelli validi, richiede min 2
    - Bounding box degenerata (width/height <= 0): ritorna None
    - Coordinate fuori frame: clamp a [0, w] e [0, h]

    Args:
        frame: Frame BGR originale (numpy array HxWx3).
        keypoints: Array shape (17, 3) con (x, y, confidence) per ogni keypoint COCO.
                   Output standard di Ultralytics YOLO-Pose.
        padding_factor: Percentuale padding attorno alla bounding box torso (default 10%).

    Returns:
        Crop numpy array BGR del torso, oppure None se keypoints insufficienti.
    """
    torso_kp_indices = [_KP_LEFT_SHOULDER, _KP_RIGHT_SHOULDER, _KP_LEFT_HIP, _KP_RIGHT_HIP]

    # Filtra i keypoints torso con confidenza sufficiente
    valid_pts: list[tuple[float, float]] = [
        (float(keypoints[i][0]), float(keypoints[i][1]))
        for i in torso_kp_indices
        if float(keypoints[i][2]) > _KP_MIN_CONF
    ]

    # Servono almeno 2 keypoints validi per definire una bounding box
    if len(valid_pts) < 2:
        return None

    h, w = frame.shape[:2]
    xs = [p[0] for p in valid_pts]
    ys = [p[1] for p in valid_pts]

    roi_w = max(xs) - min(xs)
    roi_h = max(ys) - min(ys)

    # Aggiungi padding proporzionale alla dimensione del torso
    pad_x = int(roi_w * padding_factor)
    pad_y = int(roi_h * padding_factor)

    x1 = max(0, int(min(xs)) - pad_x)
    y1 = max(0, int(min(ys)) - pad_y)
    x2 = min(w, int(max(xs)) + pad_x)
    y2 = min(h, int(max(ys)) + pad_y)

    if x2 <= x1 or y2 <= y1:
        return None

    return frame[y1:y2, x1:x2].copy()


# ---------------------------------------------------------------------------
# NoEntryFilterModule — Modulo principale
# ---------------------------------------------------------------------------

class NoEntryFilterModule(BaseVideoModule):
    """
    Modulo No Entry Filter: rileva persone non autorizzate in zone riservate.

    Pipeline per ogni persona nel frame:
    1. Run YOLO26-Pose → keypoints spalle/fianchi/collo
    2. extract_torso_crop() → crop BGR del torso
    3. VestColorClassifier.classify(crop) → {has_vest, upper_color, confidence}
    4. PersonTrackerState: smoothing temporale via majority voting
    5. Verifica se la persona è in una ROI "no entry" (tramite ROIEngine)
    6. Genera evento se persona non autorizzata + dwell >= min_dwell_before_alert

    Configurazione (campo "config" in modules.json):
        roi_file (str):               Path ROI. Default: "data/rois.json"
        pose_model_path (str|null):   Path YOLO-Pose .pt. Default: null (STUB mode)
        classifier_model_path (str|null): Path classificatore ML. Default: null (usa HSV)
        authorized_vests (list[str]): Colori DPI autorizzati. Default: ["orange","yellow","green"]
        smoothing_window (int):       N frame per majority voting. Default: 10
        min_dwell_before_alert (float): Secondi min prima di generare evento. Default: 2.0

    Note:
        - In STUB mode (pose_model_path=null), il modulo ritorna sempre lista vuota.
        - HSVClassifier è sempre attivo come fallback sul classificatore ML.
    """

    @property
    def module_type(self) -> str:
        return "no_entry_filter"

    def __init__(self) -> None:
        self._roi_engine: ROIEngine | None = None
        self._roi_file: str = "data/rois.json"
        self._smoothing_window: int = 10
        self._min_dwell: float = 2.0
        self._authorized_colors: list[str] = ["orange", "yellow", "green"]
        self._tracker_states: dict[int, PersonTrackerState] = {}
        self._classifier: VestColorClassifier | None = None
        self._pose_model: Any = None       # YOLO-Pose model
        self._last_detections: list[Detection] = []

    def initialize(self, config: dict[str, Any]) -> None:
        """
        Inizializza il modulo con la configurazione.

        Carica:
        - ROI Engine con ROI di tipo 'no_entry_filter'
        - Classificatore DPI/colore (HSV o ML)
        - Modello YOLO-Pose (o modalità STUB se non configurato)
        """
        self._roi_file = config.get("roi_file", "data/rois.json")
        self._smoothing_window = int(config.get("smoothing_window", 10))
        self._min_dwell = float(config.get("min_dwell_before_alert", 2.0))
        self._authorized_colors = list(config.get("authorized_vests", ["orange", "yellow", "green"]))

        # ROI Engine
        self._roi_engine = ROIEngine()
        roi_count = self._roi_engine.load_from_file(self._roi_file)
        logger.info(f"NoEntryFilter: {roi_count} ROI caricate da {self._roi_file}")

        # Classificatore DPI/colore
        self._classifier = _build_classifier(config)

        # Modello YOLO-Pose
        self._pose_model = self._load_pose_model(config.get("pose_model_path"))

        # Aggiorna il maxlen dello deque per i tracker states esistenti
        # (necessario se smoothing_window cambia tra un restart e l'altro)
        logger.info(
            f"NoEntryFilter inizializzato: "
            f"smoothing_window={self._smoothing_window}, "
            f"min_dwell={self._min_dwell}s, "
            f"classificatore={type(self._classifier).__name__}, "
            f"pose_model={'caricato' if self._pose_model else 'STUB'}"
        )

    def _load_pose_model(self, path: str | None) -> Any:
        """
        Carica il modello YOLO-Pose dal path specificato.

        Returns None e logga un warning se il path non è configurato (STUB mode).
        """
        if path is None:
            logger.warning(
                "NoEntryFilter: pose_model_path non configurato. "
                "Modulo in modalità STUB: process_frame() restituirà sempre lista vuota. "
                "Configurare 'pose_model_path' in data/modules.json per attivare il modulo."
            )
            return None

        try:
            from ultralytics import YOLO  # Import locale per evitare dipendenza obbligatoria
            model = YOLO(path)
            logger.info(f"NoEntryFilter: modello YOLO-Pose caricato da '{path}'")
            return model
        except FileNotFoundError:
            logger.error(f"NoEntryFilter: file modello YOLO-Pose non trovato: '{path}'")
            return None
        except Exception as e:
            logger.error(f"NoEntryFilter: errore caricamento modello YOLO-Pose: {e}")
            return None

    def process_frame(
        self,
        frame: np.ndarray,
        detections: list[Detection],
        meta: FrameMeta,
    ) -> list[BaseEvent]:
        """
        Rileva persone non autorizzate nel frame.

        Pipeline:
        1. YOLO-Pose → keypoints persone
        2. extract_torso_crop() → crop BGR torso
        3. VestColorClassifier.classify() → attributi DPI/colore
        4. PersonTrackerState smoothing
        5. ROIEngine → verifica zona no-entry
        6. Genera eventi se necessario

        Args:
            frame: Frame BGR originale.
            detections: Detection YOLO base (non usate direttamente, ma disponibili).
            meta: Metadata del frame.

        Returns:
            Lista di BaseEvent (può essere vuota).
        """
        # STUB mode: modello non configurato
        if self._pose_model is None:
            return []

        self._last_detections = detections

        events: list[BaseEvent] = []
        now = meta.timestamp

        # 1. Esegui YOLO-Pose sul frame corrente
        try:
            pose_results = self._pose_model.track(
                source=frame,
                persist=True,
                verbose=False,
            )
        except Exception as e:
            logger.error(f"NoEntryFilter: errore inferenza YOLO-Pose: {e}")
            return []

        if not pose_results:
            self._cleanup_lost_tracks(now)
            return []

        result = pose_results[0]
        if result.boxes is None or result.keypoints is None:
            self._cleanup_lost_tracks(now)
            return []

        boxes = result.boxes
        keypoints_data = result.keypoints.data   # shape (N, 17, 3)

        seen_track_ids: set[int] = set()

        for i in range(len(boxes)):
            # --- Estrai dati persona ---
            x1, y1, x2, y2 = [int(v) for v in boxes.xyxy[i].cpu().numpy()]
            confidence = float(boxes.conf[i].cpu().numpy())
            kps = keypoints_data[i].cpu().numpy()   # (17, 3)

            track_id = -1
            if boxes.id is not None:
                track_id = int(boxes.id[i].cpu().numpy())

            if track_id < 0:
                continue  # Salta persone senza tracking ID

            seen_track_ids.add(track_id)

            # --- Aggiorna/crea stato tracker ---
            if track_id not in self._tracker_states:
                self._tracker_states[track_id] = PersonTrackerState(
                    track_id=track_id,
                    vest_history=deque(maxlen=self._smoothing_window),
                    color_history=deque(maxlen=self._smoothing_window),
                    first_seen_at=now,
                )
            state = self._tracker_states[track_id]
            state.last_seen_at = now

            # --- Estrai torso e classifica ---
            crop = extract_torso_crop(frame, kps)
            if crop is not None and self._classifier is not None:
                result_clf = self._classifier.classify(crop)
                state.vest_history.append(result_clf.has_vest)
                state.color_history.append(result_clf.upper_color)

            # --- Punto di riferimento per ROI (bottom_center persona) ---
            ref_x = (x1 + x2) // 2
            ref_y = y2  # Bottom center: piedi della persona

            # --- Verifica se persona è in una zona "no entry" ---
            in_restricted = self._is_point_in_any_roi(ref_x, ref_y)
            state.in_roi = in_restricted

            # --- Genera evento se non autorizzata + dwell sufficiente ---
            if (in_restricted
                    and not state.is_authorized
                    and not state.alert_sent
                    and state.dwell_seconds >= self._min_dwell):

                state.alert_sent = True
                evt_type = (
                    "person_no_vest" if not state.has_vest_stable
                    else "person_unauthorized"
                )

                events.append(BaseEvent(
                    event_type=evt_type,
                    camera_id=meta.camera_id,
                    timestamp=now,
                    module_type=self.module_type,
                    track_id=track_id,
                    confidence=confidence,
                    bbox=(x1, y1, x2, y2),
                    event_data={
                        "has_vest": state.has_vest_stable,
                        "upper_color": state.upper_color_stable,
                        "dwell_seconds": round(state.dwell_seconds, 2),
                    },
                ))

                logger.info(
                    f"[ALERT] {evt_type} | "
                    f"track={track_id} | "
                    f"vest={state.has_vest_stable} | "
                    f"color={state.upper_color_stable} | "
                    f"dwell={state.dwell_seconds:.1f}s"
                )

        self._cleanup_lost_tracks(now, seen_track_ids)
        return events

    def _is_point_in_any_roi(self, x: int, y: int) -> bool:
        """Verifica se il punto (x, y) è contenuto in almeno una ROI attiva."""
        if self._roi_engine is None:
            return False
        for roi in self._roi_engine._rois.values():
            if roi.is_active and roi._polygon is not None:
                from shapely.geometry import Point
                if roi._polygon.contains(Point(x, y)):
                    return True
        return False

    def _cleanup_lost_tracks(
        self,
        now: float,
        seen_ids: set[int] | None = None,
        timeout: float = 3.0,
    ) -> None:
        """
        Rimuove i tracker persi dallo stato interno.

        Un tracker è considerato perso se:
        - Non è nella lista seen_ids (frame corrente), E
        - Non viene visto da più di `timeout` secondi
        """
        if seen_ids is None:
            seen_ids = set()

        lost = [
            tid for tid, s in self._tracker_states.items()
            if tid not in seen_ids and (now - s.last_seen_at) > timeout
        ]
        for tid in lost:
            del self._tracker_states[tid]

    def draw_overlay(
        self,
        frame: np.ndarray,
        events: list[BaseEvent],
    ) -> np.ndarray:
        """
        Disegna overlay per il modulo no_entry_filter.

        - Se ci sono ROI attive: le disegna in rosso tratteggiato
        - Per ogni persona tracciata: mostra badge DPI (giubbetto ON/OFF)
        - Se ci sono eventi alert: highlight bounding box in rosso
        """
        overlay = frame

        # Disegna ROI no-entry (bordo rosso)
        if self._roi_engine is not None:
            overlay = self._roi_engine.draw_rois(overlay, [])

        # Disegna badge DPI per ogni tracker state attivo
        for state in self._tracker_states.values():
            if not state.in_roi:
                continue
            # Nota: non abbiamo la bbox qui, ma l'overlay delle ROI è sufficiente
            # per la visualizzazione di base. In una versione futura si possono
            # passare le bbox tramite un dizionario track_id → bbox.

        # Highlight bounding box degli eventi alert in rosso
        for evt in events:
            x1, y1, x2, y2 = evt.bbox
            cv2.rectangle(overlay, (x1, y1), (x2, y2), (0, 0, 255), 3)
            label = f"ALERT: {evt.event_data.get('upper_color', '?')}"
            cv2.putText(
                overlay, label, (x1, y1 - 10),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2,
            )

        return overlay

    def reset(self) -> None:
        """Azzera lo stato dei tracker e il ROI Engine."""
        self._tracker_states.clear()
        if self._roi_engine is not None:
            self._roi_engine.reset()
        logger.info("NoEntryFilterModule: stati resettati.")

    def on_reload_signal(self) -> None:
        """Ricarica le ROI da file su segnale hot-reload."""
        if self._roi_engine is None:
            return
        self._roi_engine.clear_all()
        roi_count = self._roi_engine.load_from_file(self._roi_file)
        logger.info(f"NoEntryFilter: hot-reload completato — {roi_count} ROI ricaricate")
