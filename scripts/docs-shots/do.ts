/**
 * One step against the running rig (scripts/docs-shots/run.ts), for exploring a scene:
 *
 *   bun scripts/docs-shots/do.ts setup                  1440×900 at 2x, tab in front
 *   bun scripts/docs-shots/do.ts eval  '<js>'           in the page (top-level await works)
 *   bun scripts/docs-shots/do.ts peval '<js>'           in the Voyager panel frame
 *   bun scripts/docs-shots/do.ts click <x> <y>          a trusted click, page CSS px
 *   bun scripts/docs-shots/do.ts pclick '<text|css>'    click a panel control by its text or selector
 *   bun scripts/docs-shots/do.ts key <Key> [alt|shift|meta|ctrl]
 *   bun scripts/docs-shots/do.ts type '<text>'          into whatever has focus
 *   bun scripts/docs-shots/do.ts shot <out.png> [x y w h]
 *   bun scripts/docs-shots/do.ts pshot <out.png> '<css|text>' [pad]
 */
import { Rig } from './rig';

const [command, ...args] = process.argv.slice(2);
const rig = await Rig.connect();
const print = (value: unknown) => console.log(JSON.stringify(value, null, 1));

switch (command) {
  case 'setup':
    await rig.setup();
    break;
  case 'eval':
    print(await rig.evalPage(args[0]));
    break;
  case 'peval':
    print(await rig.evalPanel(args[0]));
    break;
  case 'click':
    await rig.click(Number(args[0]), Number(args[1]));
    break;
  case 'pclick':
    await rig.pclick(args[0]);
    break;
  case 'key':
    await rig.key(args[0], args[1]);
    break;
  case 'type':
    await rig.type(args[0]);
    break;
  case 'shot': {
    const [out, x, y, width, height] = args;
    await rig.shot(
      out,
      x ? { x: Number(x), y: Number(y), width: Number(width), height: Number(height) } : undefined,
    );
    break;
  }
  case 'pshot':
    print(await rig.pshot(args[0], args[1], Number(args[2] ?? 0)));
    break;
  default:
    console.error(`unknown command: ${command}`);
    process.exitCode = 1;
}
rig.close();
