/**
 * LogisticsTrack — ImageLightbox
 * Componente modale per visualizzare immagini ingrandite.
 * Si apre con un URL immagine, si chiude con click fuori o tasto ESC.
 */
import { useEffect, useCallback } from 'react';
import { X } from 'lucide-react';

export default function ImageLightbox({ src, onClose }) {
  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    // Blocca scroll del body quando il lightbox è aperto
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [handleKeyDown]);

  if (!src) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Pulsante chiudi */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 p-2 rounded-full bg-slate-800/80 text-white
                   hover:bg-slate-700 transition-colors z-10"
        aria-label="Chiudi"
      >
        <X size={24} />
      </button>

      {/* Immagine */}
      <img
        src={src}
        alt="Crop ingrandito"
        className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl
                   border border-slate-700"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
