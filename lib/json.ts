/** Parse JSON that may contain unescaped control chars in string literals (common with LLM output). */
export function parseJsonSafe<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    let inString = false;
    let escape = false;
    const out: string[] = [];
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (escape) {
        out.push(c);
        escape = false;
        continue;
      }
      if (c === "\\") {
        out.push(c);
        escape = true;
        continue;
      }
      if (!inString) {
        if (c === '"') {
          inString = true;
          out.push(c);
          continue;
        }
        out.push(c);
        continue;
      }
      if (c === '"') {
        inString = false;
        out.push(c);
        continue;
      }
      const code = c.charCodeAt(0);
      if (code >= 0 && code <= 31) {
        if (code === 10) out.push("\\n");
        else if (code === 13) out.push("\\r");
        else if (code === 9) out.push("\\t");
        else out.push(" ");
        continue;
      }
      out.push(c);
    }
    return JSON.parse(out.join("")) as T;
  }
}
