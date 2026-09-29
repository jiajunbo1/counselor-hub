import { Sun, Moon, Monitor, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTheme, type ThemeMode, type Skin, MODE_LABEL, SKIN_LABEL } from "@/lib/theme";

const MODES: { id: ThemeMode; icon: typeof Sun }[] = [
  { id: "light", icon: Sun },
  { id: "dark", icon: Moon },
  { id: "system", icon: Monitor },
];

const SKINS: { id: Skin; swatch: string }[] = [
  { id: "vibrant", swatch: "linear-gradient(135deg,#6366f1,#8b5cf6,#06b6d4)" },
  { id: "neon", swatch: "linear-gradient(135deg,#22d3ee,#a78bfa,#f472b6)" },
  { id: "glass", swatch: "linear-gradient(135deg,rgba(148,163,184,.6),rgba(203,213,225,.35))" },
  { id: "liquid", swatch: "linear-gradient(135deg,rgba(129,140,248,.55),rgba(34,211,238,.4))" },
];

export function AppearancePanel() {
  const { mode, skin, setMode, setSkin } = useTheme();
  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1.5 text-xs font-medium text-muted-foreground">明暗</div>
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1">
          {MODES.map(({ id, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setMode(id)}
              aria-pressed={mode === id}
              className={
                "flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition-all " +
                (mode === id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")
              }
            >
              <Icon className="size-3.5" />
              {MODE_LABEL[id]}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1.5 text-xs font-medium text-muted-foreground">外观皮肤</div>
        <div className="grid grid-cols-2 gap-2">
          {SKINS.map(({ id, swatch }) => (
            <button
              key={id}
              type="button"
              onClick={() => setSkin(id)}
              aria-pressed={skin === id}
              className={
                "flex items-center gap-2 rounded-xl border p-2 text-left text-xs font-medium transition-all " +
                (skin === id ? "border-primary ring-2 ring-ring/40" : "border-border hover:border-primary/50")
              }
            >
              <span className="size-6 shrink-0 rounded-lg ring-1 ring-black/5" style={{ backgroundImage: swatch }} />
              {SKIN_LABEL[id]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function AppearanceMenu({ className, align = "end" }: { className?: string; align?: "start" | "center" | "end" }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className={className} aria-label="外观设置" title="外观设置">
          <Palette className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-72">
        <AppearancePanel />
      </PopoverContent>
    </Popover>
  );
}
