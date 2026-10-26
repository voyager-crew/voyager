# Existing adapter fields outside the profile registry

Supplement to the [per-key trust ledger](PACKAGED_DATA.md). These nested `site.json`
fields already belong to existing adapter sections; this inventory does not add a
second locator channel or change section precedence. Native Gemini/AI Studio fields
remain packaged. Other sites retain their existing adapter behavior, including OFF
cache reads; fixed identity, source, destructive-action and CSS protocols are not
made remotely configurable by the new profiles. `pageHooks` aliases below are the
same two ChatGPT fields counted in the main ledger, not two extra profiles.

## chatgpt

| site.json field                             | Tier | Reason                                                                                                     |
| ------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------- |
| `theme.hostSelector`                        | §6   | Theme/CSS target is outside the page-locator profile channel.                                              |
| `theme.lightSelector`                       | §6   | Theme/CSS target is outside the page-locator profile channel.                                              |
| `theme.darkSelector`                        | §6   | Theme/CSS target is outside the page-locator profile channel.                                              |
| `projects.sidebar.row`                      | A    | Selects a project, host action or stored file/name; existing project identity/action policy applies.       |
| `projects.createButton`                     | A    | Selects a project, host action or stored file/name; existing project identity/action policy applies.       |
| `projects.createDialog.dialog`              | A    | Selects a project, host action or stored file/name; existing project identity/action policy applies.       |
| `projects.createDialog.nameInput`           | A    | Selects a project, host action or stored file/name; existing project identity/action policy applies.       |
| `projects.createDialog.submit`              | A    | Selects a project, host action or stored file/name; existing project identity/action policy applies.       |
| `projects.views.chat`                       | A    | Selects a project, host action or stored file/name; existing project identity/action policy applies.       |
| `projects.views.sources`                    | A    | Selects a project, host action or stored file/name; existing project identity/action policy applies.       |
| `projects.sources.fileInput`                | §6   | FileList writes retain the native file-input protocol.                                                     |
| `projects.sources.row`                      | A    | Selects a project, host action or stored file/name; existing project identity/action policy applies.       |
| `projects.sources.rowName`                  | A    | Selects a project, host action or stored file/name; existing project identity/action policy applies.       |
| `projects.sources.rowActions`               | A    | Selects a project, host action or stored file/name; existing project identity/action policy applies.       |
| `projects.sources.removeIcon`               | §6   | Destructive removal command identity stays in packaged interaction policy.                                 |
| `pageHooks.modeSwitch.group`                | A    | Drives the native mode-switch action; packaged mode ordering and state evidence apply.                     |
| `pageHooks.modeSwitch.button`               | A    | Drives the native mode-switch action; packaged mode ordering and state evidence apply.                     |
| `pageHooks.modelPickerTrigger`              | A    | The same source is listed as modelPicker.trigger/effort in the main ledger, with independent action proof. |
| `pageHooks.effortControl`                   | A    | The same source is listed as modelPicker.trigger/effort in the main ledger, with independent action proof. |
| `folders.sidebar`                           | A    | Also scopes stored conversation rows; native URL/ID rules remain authoritative.                            |
| `folders.rows.row`                          | A    | Supplies stored conversation identity or title; existing folder source rules remain authoritative.         |
| `folders.rows.link`                         | A    | Supplies stored conversation identity or title; existing folder source rules remain authoritative.         |
| `folders.mount.anchors[0].steps[0].find`    | B    | Chooses only the Voyager folder-panel insertion slot.                                                      |
| `folders.mount.anchors[0].steps[0].closest` | B    | Chooses only the Voyager folder-panel insertion slot.                                                      |
| `folders.hideFiled.rows`                    | §6   | Changes native row visibility; host CSS/state policy is not placement-only data.                           |
| `folders.hideFiled.keepShown[0]`            | §6   | Changes native row visibility; host CSS/state policy is not placement-only data.                           |
| `folders.hideFiled.keepShown[1]`            | §6   | Changes native row visibility; host CSS/state policy is not placement-only data.                           |
| `folders.rowMenu.trigger`                   | §6   | Native menu action/clone association stays in its existing packaged interaction policy.                    |
| `folders.rowMenu.menu`                      | §6   | Native menu action/clone association stays in its existing packaged interaction policy.                    |
| `folders.rowMenu.item`                      | §6   | Native menu action/clone association stays in its existing packaged interaction policy.                    |
