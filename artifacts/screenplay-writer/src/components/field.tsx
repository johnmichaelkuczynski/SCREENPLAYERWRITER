import { useRef, useState, type ReactNode } from "react";
import { useExtractDocument } from "@workspace/api-client-react";
import { Upload, Loader2, Trash2 } from "lucide-react";
import { countWords } from "@/lib/stream";

const MAX = 8 * 1024 * 1024;
const OK = /\.(txt|md|pdf|docx)$/i;

function toBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] ?? "");
    r.onerror = () => rej(new Error("Could not read file"));
    r.readAsDataURL(file);
  });
}

export function Field({
  id, label, hint, value, onChange, upload, rows = 6, optional, placeholder, extra, disabled,
}: {
  id: string; label: string; hint?: ReactNode; value: string; onChange: (v: string) => void;
  upload?: boolean; rows?: number; optional?: boolean; placeholder?: string; extra?: ReactNode; disabled?: boolean;
}) {
  const extract = useExtractDocument();
  const fileRef = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setErr(null);
    if (!OK.test(f.name)) return setErr("Use a TXT, MD, PDF or DOCX file.");
    if (f.size > MAX) return setErr("That file is over 8 MB.");
    try {
      const base64 = await toBase64(f);
      const r = await extract.mutateAsync({ data: { filename: f.name, base64 } });
      onChange(r.text);
      setLoaded(r.filename);
    } catch (e) {
      const d = (e as { data?: { error?: string } })?.data;
      setErr(d?.error ?? (e as Error).message ?? "Upload failed");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="rise">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1.5">
        <label htmlFor={id} className="font-semibold text-[15px] tracking-tight">
          {label}
          {optional && <span className="ml-2 text-xs font-normal text-muted-foreground">optional</span>}
        </label>
        <div className="flex items-center gap-1">
          {extra}
          {upload && (
            <>
              <input ref={fileRef} type="file" accept=".txt,.md,.pdf,.docx" className="hidden"
                data-testid={`input-file-${id}`} onChange={(e) => onFile(e.target.files?.[0])} />
              <button type="button" disabled={extract.isPending || disabled} onClick={() => fileRef.current?.click()}
                data-testid={`button-upload-${id}`}
                className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs text-primary hover:bg-accent transition-colors disabled:opacity-50">
                {extract.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                {extract.isPending ? "Reading file" : "Upload file"}
              </button>
            </>
          )}
          {value && !disabled && (
            <button type="button" onClick={() => { onChange(""); setLoaded(null); }} data-testid={`button-discard-${id}`}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
              <Trash2 className="h-3.5 w-3.5" /> Discard
            </button>
          )}
        </div>
      </div>
      {hint && <p className="text-xs text-muted-foreground mb-2">{hint}</p>}
      <textarea id={id} rows={rows} value={value} disabled={disabled} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)} data-testid={`input-${id}`}
        className="paper w-full rounded-md border border-input px-3 py-2.5 text-[15px] leading-relaxed shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/25 disabled:opacity-70 resize-y" />
      <div className="mt-1 flex justify-between text-[11px] text-muted-foreground script">
        <span>{loaded ? `From ${loaded} - edit freely` : ""}</span>
        <span>{countWords(value).toLocaleString()} words</span>
      </div>
      {err && <p className="mt-1 text-xs text-destructive" data-testid={`text-upload-error-${id}`}>{err}</p>}
    </div>
  );
}
