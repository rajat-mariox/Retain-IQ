"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { ProjectForm } from "@/components/projects/ProjectForm";
import type { ProjectDetail, ProjectPerson, ProjectSettings, ProjectTeamOption } from "@/lib/api";

export function EditProjectButton({ project, people, teams, settings }: { project: ProjectDetail; people: ProjectPerson[]; teams: ProjectTeamOption[]; settings?: ProjectSettings | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-panel px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
        <Pencil className="size-3.5" /> Edit project
      </button>
      {open ? <ProjectForm open={open} onClose={() => setOpen(false)} project={project} people={people} teams={teams} settings={settings} /> : null}
    </>
  );
}
