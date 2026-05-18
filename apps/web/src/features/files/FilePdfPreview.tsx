import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";

import { IconButton } from "../../shared/ui";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type PdfDocument = Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>;

type FilePdfPreviewLabels = {
  error: string;
  loading: string;
  nextPage: string;
  pageStatus: (page: number, totalPages: number) => string;
  previousPage: string;
  zoomIn: string;
  zoomOut: string;
};

type FilePdfPreviewProps = {
  fileName: string;
  fileUrl: string;
  labels: FilePdfPreviewLabels;
};

export function FilePdfPreview({ fileName, fileUrl, labels }: FilePdfPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [document, setDocument] = useState<PdfDocument | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.2);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [isRendering, setIsRendering] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let loadedDocument: PdfDocument | null = null;
    setDocument(null);
    setPageNumber(1);
    setTotalPages(0);
    setStatus("loading");

    const loadingTask = pdfjs.getDocument(fileUrl);
    loadingTask.promise
      .then((nextDocument) => {
        if (cancelled) {
          void nextDocument.destroy();
          return;
        }
        loadedDocument = nextDocument;
        setDocument(nextDocument);
        setTotalPages(nextDocument.numPages);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("error");
        }
      });

    return () => {
      cancelled = true;
      if (loadedDocument) {
        void loadedDocument.destroy();
      } else {
        void loadingTask.destroy();
      }
    };
  }, [fileUrl]);

  useEffect(() => {
    if (!document || status !== "ready") {
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | null = null;
    setIsRendering(true);

    document
      .getPage(pageNumber)
      .then((page) => {
        if (cancelled) {
          return null;
        }
        const viewport = page.getViewport({ scale });
        const context = canvas.getContext("2d");
        if (!context) {
          throw new Error("canvas context unavailable");
        }
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        canvas.style.width = `${Math.ceil(viewport.width)}px`;
        canvas.style.height = `${Math.ceil(viewport.height)}px`;
        renderTask = page.render({ canvas, canvasContext: context, viewport });
        return renderTask.promise;
      })
      .then(() => {
        if (!cancelled) {
          setIsRendering(false);
        }
      })
      .catch((error) => {
        if (cancelled || error?.name === "RenderingCancelledException") {
          return;
        }
        setStatus("error");
        setIsRendering(false);
      });

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [document, pageNumber, scale, status]);

  const zoomPercent = `${Math.round(scale * 100)}%`;
  const canGoPrevious = pageNumber > 1 && status === "ready";
  const canGoNext = totalPages > 0 && pageNumber < totalPages && status === "ready";

  return (
    <div className="files-pdf-preview" aria-label={fileName}>
      <div className="files-preview-controls">
        <IconButton
          disabled={!canGoPrevious}
          label={labels.previousPage}
          onClick={() => setPageNumber((current) => Math.max(1, current - 1))}
        >
          <ChevronLeft aria-hidden="true" />
        </IconButton>
        <span className="files-preview-control-status">
          {labels.pageStatus(pageNumber, totalPages)}
        </span>
        <IconButton
          disabled={!canGoNext}
          label={labels.nextPage}
          onClick={() => setPageNumber((current) => Math.min(totalPages, current + 1))}
        >
          <ChevronRight aria-hidden="true" />
        </IconButton>
        <IconButton
          disabled={scale <= 0.6 || status !== "ready"}
          label={labels.zoomOut}
          onClick={() => setScale((current) => Math.max(0.6, current - 0.2))}
        >
          <ZoomOut aria-hidden="true" />
        </IconButton>
        <span className="files-preview-control-status">{zoomPercent}</span>
        <IconButton
          disabled={scale >= 2.4 || status !== "ready"}
          label={labels.zoomIn}
          onClick={() => setScale((current) => Math.min(2.4, current + 0.2))}
        >
          <ZoomIn aria-hidden="true" />
        </IconButton>
      </div>

      <div className="files-pdf-canvas-shell">
        {status === "loading" ? <p className="modal-copy">{labels.loading}</p> : null}
        {status === "error" ? <p className="modal-copy">{labels.error}</p> : null}
        <canvas
          aria-busy={isRendering}
          className={status === "ready" ? "files-pdf-canvas" : "files-pdf-canvas files-pdf-canvas-hidden"}
          ref={canvasRef}
        />
      </div>
    </div>
  );
}
