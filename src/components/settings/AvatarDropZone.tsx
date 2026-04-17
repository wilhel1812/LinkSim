import { useCallback, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { updateMyProfile, uploadAvatar, type CloudUser } from "../../lib/cloudUser";
import { getUiErrorMessage } from "../../lib/uiError";
import { AvatarBadge } from "../AvatarBadge";
import { ActionButton } from "../ActionButton";

type AvatarDropZoneProps = {
  name: string;
  avatarUrl: string | null | undefined;
  onUpdated: (user: CloudUser) => void;
};

type Step = "idle" | "processing" | "uploading" | "saved" | "error";

const stepLabel: Record<Step, string> = {
  idle: "",
  processing: "Resizing image…",
  uploading: "Uploading avatar…",
  saved: "Avatar saved",
  error: "",
};

const stepProgress: Record<Step, number | "indeterminate" | null> = {
  idle: null,
  processing: 35,
  uploading: "indeterminate",
  saved: 100,
  error: null,
};

const loadImageFromFile = async (file: File): Promise<HTMLImageElement> => {
  const objectUrl = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Unable to decode image."));
      img.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

const resizeAvatarFileToDataUrl = async (
  file: File,
): Promise<{ originalDataUrl: string; thumbDataUrl: string }> => {
  const image = await loadImageFromFile(file);
  const maxOriginal = 2048;
  const maxThumb = 320;
  const originalScale = Math.min(1, maxOriginal / Math.max(image.width, image.height));
  const thumbScale = Math.min(1, maxThumb / Math.max(image.width, image.height));
  const originalWidth = Math.max(1, Math.round(image.width * originalScale));
  const originalHeight = Math.max(1, Math.round(image.height * originalScale));
  const thumbWidth = Math.max(1, Math.round(image.width * thumbScale));
  const thumbHeight = Math.max(1, Math.round(image.height * thumbScale));

  const originalCanvas = document.createElement("canvas");
  originalCanvas.width = originalWidth;
  originalCanvas.height = originalHeight;
  const originalCtx = originalCanvas.getContext("2d");
  if (!originalCtx) throw new Error("Canvas unavailable for image resize.");
  originalCtx.drawImage(image, 0, 0, originalWidth, originalHeight);

  const thumbCanvas = document.createElement("canvas");
  thumbCanvas.width = thumbWidth;
  thumbCanvas.height = thumbHeight;
  const thumbCtx = thumbCanvas.getContext("2d");
  if (!thumbCtx) throw new Error("Canvas unavailable for thumbnail resize.");
  thumbCtx.drawImage(image, 0, 0, thumbWidth, thumbHeight);

  const originalDataUrl = originalCanvas.toDataURL("image/webp", 0.86);
  const thumbDataUrl = thumbCanvas.toDataURL("image/webp", 0.8);
  if (originalDataUrl.length > 7_000_000) {
    throw new Error("Profile image is still too large after resize.");
  }
  if (thumbDataUrl.length > 1_400_000) {
    throw new Error("Profile thumbnail is still too large after resize.");
  }
  return { originalDataUrl, thumbDataUrl };
};

export function AvatarDropZone({ name, avatarUrl, onUpdated }: AvatarDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const busy = step === "processing" || step === "uploading";

  const handleFile = useCallback(
    async (file: File) => {
      setStep("processing");
      setErrorMessage("");
      // Local preview for immediate feedback.
      const localPreview = URL.createObjectURL(file);
      setPreviewUrl(localPreview);
      try {
        const resized = await resizeAvatarFileToDataUrl(file);
        setStep("uploading");
        const uploaded = await uploadAvatar(resized.originalDataUrl, resized.thumbDataUrl);
        onUpdated(uploaded.user);
        setStep("saved");
        window.setTimeout(() => {
          setStep((current) => (current === "saved" ? "idle" : current));
        }, 1800);
      } catch (error) {
        setStep("error");
        setErrorMessage(getUiErrorMessage(error));
        setPreviewUrl(null);
      } finally {
        URL.revokeObjectURL(localPreview);
      }
    },
    [onUpdated],
  );

  const openPicker = () => {
    if (busy) return;
    inputRef.current?.click();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openPicker();
    }
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (busy) return;
    setIsDragOver(true);
  };

  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(false);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(false);
    if (busy) return;
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setStep("error");
      setErrorMessage("Please drop an image file.");
      return;
    }
    void handleFile(file);
  };

  const removeAvatar = async () => {
    if (busy) return;
    setStep("uploading");
    setErrorMessage("");
    try {
      const updated = await updateMyProfile({ avatarUrl: "" });
      setPreviewUrl(null);
      onUpdated(updated);
      setStep("saved");
      window.setTimeout(() => {
        setStep((current) => (current === "saved" ? "idle" : current));
      }, 1800);
    } catch (error) {
      setStep("error");
      setErrorMessage(getUiErrorMessage(error));
    }
  };

  const displayUrl = previewUrl ?? avatarUrl ?? undefined;
  const progress = stepProgress[step];

  const zoneClasses = ["avatar-dropzone"];
  if (isDragOver) zoneClasses.push("avatar-dropzone-drag-over");
  if (busy) zoneClasses.push("avatar-dropzone-busy");
  if (step === "error") zoneClasses.push("avatar-dropzone-error");

  return (
    <div className="avatar-dropzone-wrapper">
      <div
        className={zoneClasses.join(" ")}
        role="button"
        tabIndex={0}
        aria-label="Upload profile picture — click or drop an image"
        aria-busy={busy || undefined}
        onClick={openPicker}
        onKeyDown={onKeyDown}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <div className="avatar-dropzone-preview">
          <AvatarBadge
            name={name}
            avatarUrl={displayUrl}
            imageClassName="avatar-dropzone-image"
            fallbackClassName="avatar-dropzone-image avatar-dropzone-initials"
            fallbackAs="div"
          />
        </div>
        <div className="avatar-dropzone-copy">
          <div className="avatar-dropzone-title">
            <ImagePlus size={16} strokeWidth={2} aria-hidden="true" />
            <span>Drop an image or click to upload</span>
          </div>
          <div className="avatar-dropzone-hint">PNG, JPG, or WebP · resized automatically</div>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="avatar-dropzone-input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void handleFile(file);
          }}
        />
      </div>

      {progress != null ? (
        <div className="avatar-dropzone-progress" aria-live="polite">
          <div className="map-progress-label">{stepLabel[step]}</div>
          <div
            className="map-progress-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={typeof progress === "number" ? progress : undefined}
          >
            {progress === "indeterminate" ? (
              <div className="map-progress-fill map-progress-fill-indeterminate" />
            ) : (
              <div className="map-progress-fill" style={{ width: `${progress}%` }} />
            )}
          </div>
        </div>
      ) : null}

      {step === "error" && errorMessage ? (
        <div className="avatar-dropzone-error-text" role="alert">
          {errorMessage}
        </div>
      ) : null}

      <div className="avatar-dropzone-actions">
        <ActionButton type="button" onClick={openPicker} disabled={busy}>
          Upload image
        </ActionButton>
        {(avatarUrl || previewUrl) && !busy ? (
          <button
            type="button"
            className="avatar-dropzone-remove"
            onClick={() => void removeAvatar()}
            aria-label="Remove profile picture"
          >
            <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
            <span>Remove</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
