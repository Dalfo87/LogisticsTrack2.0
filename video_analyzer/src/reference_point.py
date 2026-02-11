"""
LogisticsTrack — Reference Point Strategy
Calcola il punto di riferimento spaziale dal bounding box di un oggetto rilevato.
Il punto scelto determina quando un oggetto è "dentro" o "fuori" da una ROI.
"""

from enum import Enum
from typing import Tuple


class ReferencePoint(Enum):
    """Punto del bounding box usato come riferimento spaziale."""
    BOTTOM_CENTER = "bottom_center"   # Piedi / base oggetto (default muletti)
    CENTROID = "centroid"             # Baricentro geometrico del bbox
    TOP_CENTER = "top_center"         # Testa / punto alto (camere inclinate dall'alto)


def compute_reference_point(
    bbox: Tuple[int, int, int, int],
    strategy: ReferencePoint = ReferencePoint.BOTTOM_CENTER
) -> Tuple[float, float]:
    """
    Calcola il punto di riferimento dato un bounding box.

    Args:
        bbox: (x1, y1, x2, y2) coordinate del bounding box
        strategy: quale punto del bbox usare

    Returns:
        (x, y) coordinate del punto di riferimento
    """
    x1, y1, x2, y2 = bbox
    cx = (x1 + x2) / 2.0

    if strategy == ReferencePoint.BOTTOM_CENTER:
        return (cx, float(y2))
    elif strategy == ReferencePoint.TOP_CENTER:
        return (cx, float(y1))
    elif strategy == ReferencePoint.CENTROID:
        cy = (y1 + y2) / 2.0
        return (cx, cy)
    else:
        # Fallback sicuro
        return (cx, float(y2))
