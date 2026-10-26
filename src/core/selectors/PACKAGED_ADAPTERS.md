# Existing adapter fields outside the profile registry

Supplement to the [per-key trust ledger](PACKAGED_DATA.md). These nested `site.json`
fields already belong to existing adapter sections; this inventory does not add a
second locator channel or change section precedence. Native Gemini/AI Studio fields
remain packaged. Other sites retain their existing adapter behavior, including OFF
cache reads; fixed identity, source, destructive-action and CSS protocols are not
made remotely configurable by the new profiles. `pageHooks` aliases below are the
same two ChatGPT fields counted in the main ledger, not two extra profiles.

## gemini

| site.json field                             | Tier | Reason                                                                                             |
| ------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------- |
| `theme.hostSelector`                        | §6   | Theme/CSS target is outside the page-locator profile channel.                                      |
| `theme.lightSelector`                       | §6   | Theme/CSS target is outside the page-locator profile channel.                                      |
| `theme.darkSelector`                        | §6   | Theme/CSS target is outside the page-locator profile channel.                                      |
| `folders.sidebar`                           | A    | Also scopes stored conversation rows; native URL/ID rules remain authoritative.                    |
| `folders.rows.row`                          | A    | Supplies stored conversation identity or title; existing folder source rules remain authoritative. |
| `folders.rows.link`                         | A    | Supplies stored conversation identity or title; existing folder source rules remain authoritative. |
| `folders.mount.anchors[0].steps[0].find`    | B    | Chooses only the Voyager folder-panel insertion slot.                                              |
| `folders.mount.anchors[0].steps[1].find`    | B    | Chooses only the Voyager folder-panel insertion slot.                                              |
| `folders.mount.anchors[0].steps[1].closest` | B    | Chooses only the Voyager folder-panel insertion slot.                                              |
| `folders.mount.anchors[1].steps[0].find`    | B    | Chooses only the Voyager folder-panel insertion slot.                                              |

## aistudio

| site.json field         | Tier | Reason                                                                                             |
| ----------------------- | ---- | -------------------------------------------------------------------------------------------------- |
| `theme.hostSelector`    | §6   | Theme/CSS target is outside the page-locator profile channel.                                      |
| `theme.lightSelector`   | §6   | Theme/CSS target is outside the page-locator profile channel.                                      |
| `theme.darkSelector`    | §6   | Theme/CSS target is outside the page-locator profile channel.                                      |
| `folders.sidebar`       | A    | Also scopes stored conversation rows; native URL/ID rules remain authoritative.                    |
| `folders.rows.row`      | A    | Supplies stored conversation identity or title; existing folder source rules remain authoritative. |
| `folders.rows.portaled` | §6   | Native menu/dialog exclusion is the folder interaction safety floor.                               |

## claude

| site.json field                          | Tier | Reason                                                                                             |
| ---------------------------------------- | ---- | -------------------------------------------------------------------------------------------------- |
| `theme.hostSelector`                     | §6   | Theme/CSS target is outside the page-locator profile channel.                                      |
| `theme.lightSelector`                    | §6   | Theme/CSS target is outside the page-locator profile channel.                                      |
| `theme.darkSelector`                     | §6   | Theme/CSS target is outside the page-locator profile channel.                                      |
| `export.generating`                      | A    | Export readiness uses the native generation-state predicate, not UI placement.                     |
| `folders.sidebar`                        | A    | Also scopes stored conversation rows; native URL/ID rules remain authoritative.                    |
| `folders.rows.row`                       | A    | Supplies stored conversation identity or title; existing folder source rules remain authoritative. |
| `folders.rows.link`                      | A    | Supplies stored conversation identity or title; existing folder source rules remain authoritative. |
| `folders.rows.title[0]`                  | A    | Supplies stored conversation identity or title; existing folder source rules remain authoritative. |
| `folders.mount.anchors[0].steps[0].find` | B    | Chooses only the Voyager folder-panel insertion slot.                                              |
| `folders.hideFiled.rows`                 | §6   | Changes native row visibility; host CSS/state policy is not placement-only data.                   |
| `folders.hideFiled.keepShown[0]`         | §6   | Changes native row visibility; host CSS/state policy is not placement-only data.                   |
| `folders.rowMenu.trigger`                | §6   | Native menu action/clone association stays in its existing packaged interaction policy.            |
| `folders.rowMenu.menu`                   | §6   | Native menu action/clone association stays in its existing packaged interaction policy.            |
| `folders.rowMenu.item`                   | §6   | Native menu action/clone association stays in its existing packaged interaction policy.            |
| `folders.rowMenu.template`               | §6   | Native menu action/clone association stays in its existing packaged interaction policy.            |
| `folders.rowMenu.iconHolder`             | §6   | Native menu action/clone association stays in its existing packaged interaction policy.            |

## deepseek

| site.json field                          | Tier | Reason                                                                                             |
| ---------------------------------------- | ---- | -------------------------------------------------------------------------------------------------- |
| `theme.hostSelector`                     | §6   | Theme/CSS target is outside the page-locator profile channel.                                      |
| `theme.lightSelector`                    | §6   | Theme/CSS target is outside the page-locator profile channel.                                      |
| `theme.darkSelector`                     | §6   | Theme/CSS target is outside the page-locator profile channel.                                      |
| `folders.sidebar`                        | A    | Also scopes stored conversation rows; native URL/ID rules remain authoritative.                    |
| `folders.rows.row`                       | A    | Supplies stored conversation identity or title; existing folder source rules remain authoritative. |
| `folders.mount.anchors[0].steps[0].find` | B    | Chooses only the Voyager folder-panel insertion slot.                                              |
| `folders.mount.anchors[0].steps[1].find` | B    | Chooses only the Voyager folder-panel insertion slot.                                              |

## kimi

| site.json field                          | Tier | Reason                                                                                             |
| ---------------------------------------- | ---- | -------------------------------------------------------------------------------------------------- |
| `theme.hostSelector`                     | §6   | Theme/CSS target is outside the page-locator profile channel.                                      |
| `theme.lightSelector`                    | §6   | Theme/CSS target is outside the page-locator profile channel.                                      |
| `theme.darkSelector`                     | §6   | Theme/CSS target is outside the page-locator profile channel.                                      |
| `folders.sidebar`                        | A    | Also scopes stored conversation rows; native URL/ID rules remain authoritative.                    |
| `folders.rows.row`                       | A    | Supplies stored conversation identity or title; existing folder source rules remain authoritative. |
| `folders.hideFiled.rows`                 | §6   | Changes native row visibility; host CSS/state policy is not placement-only data.                   |
| `folders.mount.anchors[0].steps[0].find` | B    | Chooses only the Voyager folder-panel insertion slot.                                              |

ChatGPT fields are in [the continuation](PACKAGED_ADAPTER_CHATGPT.md).
