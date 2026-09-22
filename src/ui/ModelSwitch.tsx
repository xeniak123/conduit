import { useState } from "react";
import { AnimatePresence } from "motion/react";
import { useApp } from "@/core/store";
import { presetFor } from "@/llm/presets";
import { useRuntime } from "@/models/runtime";
import { BrandMark, brandForModel } from "./Brand";
import { Icon } from "./icons";
import { ModelPicker } from "./ModelPicker";

/** The model name at the top of a chat, which is also the way to change it. */
export function ModelSwitch() {
  const command = useApp((s) => s.settings.command);
  const custom = useApp((s) => s.settings.customProviders);
  const loaded = useRuntime((s) => s.loaded);
  const [open, setOpen] = useState(false);

  const provider =
    command.provider === "local"
      ? "This computer"
      : (custom.find((p) => p.id === command.provider)?.label ?? presetFor(command.provider)?.label ?? command.provider);

  return (
    <>
      <button className="modelswitch" onPointerDown={() => setOpen(true)}>
        {command.provider === "local" && loaded && <span className="modelswitch__live" />}
        <BrandMark brand={brandForModel(command.model, command.provider)} size={20} fallback={provider} />
        <b>{command.model}</b>
        <span className="modelswitch__via">{provider}</span>
        <Icon.chevron />
      </button>
      <AnimatePresence>{open && <ModelPicker onClose={() => setOpen(false)} />}</AnimatePresence>
    </>
  );
}
