"""
LogisticsTrack — Services Router
API per il monitoraggio e il controllo dei container Docker.

Richiede che il socket Docker sia montato nel container:
  /var/run/docker.sock:/var/run/docker.sock
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

logger = logging.getLogger("ServicesRouter")

router = APIRouter(prefix="/api/services", tags=["services"])

# Container Docker tracciati (nome_logico → container_name)
TRACKED_SERVICES: dict[str, str] = {
    "video_analyzer": "lt_video_analyzer",
    "backend":        "lt_backend",
    "mosquitto":      "lt_mosquitto",
    "postgres":       "lt_postgres",
    "frontend":       "lt_frontend",
}

# Servizi per cui il restart è disabilitato (troppo pericoloso)
RESTART_BLOCKED: set[str] = {"postgres"}


def _get_docker_client():
    """
    Restituisce un client Docker.
    Solleva HTTPException 503 se il socket non è disponibile.
    """
    try:
        import docker
        return docker.from_env()
    except ImportError:
        raise HTTPException(
            status_code=503,
            detail="Libreria docker non installata. Aggiungere 'docker>=7.0.0' a requirements.txt.",
        )
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Impossibile connettersi al Docker daemon. Verificare che /var/run/docker.sock sia montato. Errore: {exc}",
        )


def _container_info(name_logical: str, container_name: str, client) -> dict:
    """
    Recupera le informazioni di un container Docker.
    Restituisce un dict con status anche se il container non esiste.
    """
    try:
        import docker.errors
        container = client.containers.get(container_name)
        attrs = container.attrs or {}

        started_at_raw = attrs.get("State", {}).get("StartedAt", "")
        started_at = None
        if started_at_raw and started_at_raw != "0001-01-01T00:00:00Z":
            try:
                # Docker usa formato RFC3339 con nanosecondi — trunca a microsec
                started_at = started_at_raw[:26] + "Z"
                started_at = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
                started_at = started_at.isoformat()
            except Exception:
                started_at = started_at_raw

        image_tags = attrs.get("Config", {}).get("Image", "")

        return {
            "name": name_logical,
            "container_name": container_name,
            "status": container.status,   # "running", "exited", "paused", ecc.
            "started_at": started_at,
            "image": image_tags,
            "restart_allowed": name_logical not in RESTART_BLOCKED,
        }

    except Exception as exc:
        # Container non trovato o altro errore
        import docker.errors
        if isinstance(exc, docker.errors.NotFound):
            status = "not_found"
        else:
            status = "unknown"
            logger.warning(f"Errore recupero info container {container_name}: {exc}")

        return {
            "name": name_logical,
            "container_name": container_name,
            "status": status,
            "started_at": None,
            "image": None,
            "restart_allowed": name_logical not in RESTART_BLOCKED,
        }


@router.get("")
async def list_services():
    """
    Restituisce lo stato di tutti i container Docker tracciati.
    Richiede il socket Docker montato nel backend.
    """
    client = _get_docker_client()
    services = [
        _container_info(name_logical, container_name, client)
        for name_logical, container_name in TRACKED_SERVICES.items()
    ]
    client.close()
    return services


@router.post("/{service_name}/restart")
async def restart_service(service_name: str):
    """
    Riavvia un container Docker.
    Non permesso per 'postgres'.
    """
    if service_name not in TRACKED_SERVICES:
        raise HTTPException(
            status_code=404,
            detail=f"Servizio '{service_name}' non trovato. Servizi disponibili: {list(TRACKED_SERVICES.keys())}",
        )

    if service_name in RESTART_BLOCKED:
        raise HTTPException(
            status_code=403,
            detail=f"Restart del servizio '{service_name}' non consentito per ragioni di sicurezza.",
        )

    container_name = TRACKED_SERVICES[service_name]
    client = _get_docker_client()

    try:
        import docker.errors
        container = client.containers.get(container_name)
        container.restart(timeout=10)
        logger.info(f"Container {container_name} riavviato via API")
        return {
            "status": "restarting",
            "service": service_name,
            "container": container_name,
        }
    except Exception as exc:
        import docker.errors
        if isinstance(exc, docker.errors.NotFound):
            raise HTTPException(
                status_code=404,
                detail=f"Container '{container_name}' non trovato.",
            )
        raise HTTPException(
            status_code=500,
            detail=f"Errore durante il restart di '{container_name}': {exc}",
        )
    finally:
        client.close()
