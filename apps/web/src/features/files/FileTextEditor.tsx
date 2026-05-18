import { useEffect, useRef } from "react";
import { basicSetup, EditorView } from "codemirror";
import { Compartment, EditorState } from "@codemirror/state";

import { cx } from "../../shared/ui/classNames";

type FileTextEditorProps = {
  ariaLabel: string;
  disabled?: boolean;
  editable: boolean;
  onChange: (value: string) => void;
  value: string;
};

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    minHeight: "100%",
    backgroundColor: "transparent",
    color: "var(--ui-text)"
  },
  ".cm-scroller": {
    height: "100%",
    minHeight: "100%",
    fontFamily: "var(--ui-font-mono)",
    fontSize: "13px",
    lineHeight: "1.55"
  },
  ".cm-content": {
    minHeight: "100%",
    padding: "12px 0"
  },
  ".cm-gutters": {
    borderRight: "1px solid var(--ui-border)",
    backgroundColor: "color-mix(in srgb, var(--ui-control-bg) 88%, transparent)",
    color: "var(--ui-muted)"
  },
  ".cm-line": {
    padding: "0 14px"
  },
  ".cm-activeLine": {
    backgroundColor: "var(--ui-active-bg)"
  },
  ".cm-activeLineGutter": {
    backgroundColor: "var(--ui-active-bg)",
    color: "var(--ui-text)"
  },
  ".cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, var(--ui-accent) 28%, transparent) !important"
  },
  "&.cm-focused": {
    outline: "none"
  },
  "&.cm-focused .cm-cursor": {
    borderLeftColor: "var(--ui-accent)"
  }
});

export function FileTextEditor({ ariaLabel, disabled = false, editable, onChange, value }: FileTextEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const syncingRef = useRef(false);
  const editableCompartmentRef = useRef(new Compartment());
  const readOnlyCompartmentRef = useRef(new Compartment());

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const parent = containerRef.current;
    if (!parent) {
      return;
    }

    const isEditable = editable && !disabled;
    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        EditorView.lineWrapping,
        editorTheme,
        readOnlyCompartmentRef.current.of(EditorState.readOnly.of(!isEditable)),
        editableCompartmentRef.current.of(EditorView.editable.of(isEditable)),
        EditorView.contentAttributes.of({
          "aria-label": ariaLabel,
          "aria-multiline": "true",
          role: "textbox"
        }),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged || syncingRef.current) {
            return;
          }
          onChangeRef.current(update.state.doc.toString());
        })
      ]
    });
    const view = new EditorView({ parent, state });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [ariaLabel]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    const currentValue = view.state.doc.toString();
    if (currentValue === value) {
      return;
    }
    syncingRef.current = true;
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: value
      }
    });
    syncingRef.current = false;
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    const isEditable = editable && !disabled;
    view.dispatch({
      effects: [
        readOnlyCompartmentRef.current.reconfigure(EditorState.readOnly.of(!isEditable)),
        editableCompartmentRef.current.reconfigure(EditorView.editable.of(isEditable))
      ]
    });
  }, [disabled, editable]);

  return (
    <div
      className={cx("files-text-editor", editable ? "files-text-editor-editing" : "files-text-editor-readonly")}
      ref={containerRef}
    />
  );
}
