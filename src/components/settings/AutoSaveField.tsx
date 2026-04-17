import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { getUiErrorMessage } from "../../lib/uiError";
import { AutoSaveIndicator, type AutoSaveState } from "../ui/AutoSaveIndicator";

type BaseProps = {
  id: string;
  label: string;
  value: string;
  /**
   * Commit handler — called on blur when the value differs from the initial value.
   * Should return a promise that resolves on save success and rejects on failure.
   */
  onSave: (nextValue: string) => Promise<void>;
  /** Client-side validation run before calling onSave. Return null/empty to accept. */
  validate?: (nextValue: string) => string | null;
  /** Optional inline help below the field. */
  help?: ReactNode;
  /** Optional external error to display (e.g., from server). Overrides local save error. */
  externalError?: string | null;
  className?: string;
};

type InputFieldProps = BaseProps & {
  as?: "input";
  inputProps?: Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "value" | "onChange" | "onBlur">;
};

type TextareaFieldProps = BaseProps & {
  as: "textarea";
  textareaProps?: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id" | "value" | "onChange" | "onBlur">;
};

export type AutoSaveFieldProps = InputFieldProps | TextareaFieldProps;

const SAVED_FADE_MS = 1800;

/**
 * Auto-save-on-blur wrapper for a single text input or textarea.
 * Renders label + input + inline AutoSaveIndicator.
 * Does NOT manage network retries or debouncing; one save per blur.
 */
export function AutoSaveField(props: AutoSaveFieldProps) {
  const { id, label, value, onSave, validate, help, externalError, className } = props;
  const [draft, setDraft] = useState(value);
  const [state, setState] = useState<AutoSaveState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const lastSavedRef = useRef(value);
  const savedTimerRef = useRef<number | null>(null);

  useEffect(() => {
    // Sync external value changes when not actively editing or saving.
    if (state === "saving") return;
    setDraft(value);
    lastSavedRef.current = value;
  }, [value, state]);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current != null) {
        window.clearTimeout(savedTimerRef.current);
      }
    };
  }, []);

  const commit = useCallback(
    async (nextValue: string) => {
      if (nextValue === lastSavedRef.current) return;
      if (validate) {
        const validationError = validate(nextValue);
        if (validationError) {
          setState("error");
          setErrorMessage(validationError);
          return;
        }
      }
      setState("saving");
      setErrorMessage(null);
      try {
        await onSave(nextValue);
        lastSavedRef.current = nextValue;
        setState("saved");
        if (savedTimerRef.current != null) window.clearTimeout(savedTimerRef.current);
        savedTimerRef.current = window.setTimeout(() => setState("idle"), SAVED_FADE_MS);
      } catch (error) {
        setState("error");
        setErrorMessage(getUiErrorMessage(error));
      }
    },
    [onSave, validate],
  );

  const handleChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setDraft(event.target.value);
    if (state === "error" || state === "saved") {
      setState("idle");
      setErrorMessage(null);
    }
  };

  const handleBlur = () => {
    void commit(draft);
  };

  const resolvedError = externalError ?? (state === "error" ? errorMessage : null);
  const classes = ["autosave-field"];
  if (resolvedError) classes.push("autosave-field-error");
  if (className) classes.push(className);

  return (
    <div className={classes.join(" ")}>
      <label htmlFor={id} className="autosave-field-label">
        <span>{label}</span>
        <AutoSaveIndicator state={state} errorMessage={errorMessage} fieldLabel={label} />
      </label>
      {props.as === "textarea" ? (
        <textarea
          id={id}
          className={resolvedError ? "input-error" : undefined}
          value={draft}
          onChange={handleChange}
          onBlur={handleBlur}
          aria-invalid={resolvedError ? true : undefined}
          aria-describedby={resolvedError ? `${id}-error` : undefined}
          {...props.textareaProps}
        />
      ) : (
        <input
          id={id}
          className={resolvedError ? "input-error" : undefined}
          value={draft}
          onChange={handleChange}
          onBlur={handleBlur}
          aria-invalid={resolvedError ? true : undefined}
          aria-describedby={resolvedError ? `${id}-error` : undefined}
          {...(props as InputFieldProps).inputProps}
        />
      )}
      {resolvedError ? (
        <div id={`${id}-error`} className="autosave-field-error-text" role="alert">
          {resolvedError}
        </div>
      ) : help ? (
        <div className="field-help">{help}</div>
      ) : null}
    </div>
  );
}
