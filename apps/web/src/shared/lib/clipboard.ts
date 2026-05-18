export async function copyTextToClipboard(text: string) {
  if (copyTextWithClipboardEvent(text)) {
    return true;
  }

  if (window.isSecureContext && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // A user-gesture fallback has already been attempted above.
    }
  }

  return false;
}

function copyTextWithClipboardEvent(text: string) {
  if (typeof document.execCommand !== "function") {
    return false;
  }

  const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.width = "1px";
  textarea.style.height = "1px";
  textarea.style.padding = "0";
  textarea.style.border = "0";
  textarea.style.opacity = "0.01";
  textarea.style.pointerEvents = "none";

  let copied = false;
  const handleCopy = (event: ClipboardEvent) => {
    if (!event.clipboardData) {
      return;
    }
    event.preventDefault();
    event.clipboardData.setData("text/plain", text);
    copied = true;
  };

  document.body.appendChild(textarea);
  textarea.focus({ preventScroll: true });
  textarea.select();
  textarea.setSelectionRange(0, text.length);
  document.addEventListener("copy", handleCopy);
  try {
    return document.execCommand("copy") && copied;
  } catch {
    return false;
  } finally {
    document.removeEventListener("copy", handleCopy);
    document.body.removeChild(textarea);
    activeElement?.focus({ preventScroll: true });
  }
}
