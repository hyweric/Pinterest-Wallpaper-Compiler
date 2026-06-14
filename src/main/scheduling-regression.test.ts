import test from "node:test";
import assert from "node:assert/strict";
import { createProject, createWallpaperTemplate, workspaceFromTemplate } from "../renderer/project.js";

test("switching templates preserves global wallpaper schedule and pause state", () => {
  const project = createProject();
  project.wallpaper = {
    ...project.wallpaper,
    enabled: true,
    paused: false,
    interval: "5s",
    customIntervalValue: 5,
    customIntervalUnit: "seconds",
    nextScheduledAt: "2026-06-14T12:00:05.000Z"
  };

  const templateProject = createProject();
  templateProject.wallpaper = {
    ...templateProject.wallpaper,
    enabled: false,
    paused: true,
    interval: "manual",
    nextScheduledAt: undefined
  };
  const template = createWallpaperTemplate(templateProject, { name: "Old snapshot" });

  const workspace = workspaceFromTemplate(project, template);
  assert.equal(workspace.wallpaper.enabled, true);
  assert.equal(workspace.wallpaper.paused, false);
  assert.equal(workspace.wallpaper.interval, "5s");
  assert.equal(workspace.wallpaper.nextScheduledAt, "2026-06-14T12:00:05.000Z");
});
