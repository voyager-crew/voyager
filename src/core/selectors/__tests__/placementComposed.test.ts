import { afterEach, expect, it } from 'vitest';

import { isSafePlacementMount } from '../placement';

afterEach(() => document.body.replaceChildren());

it('a slotted mount cannot put Voyager controls inside a shadow button', () => {
  const host = document.createElement('native-control');
  const target = document.createElement('span');
  host.append(target);
  document.body.append(host);
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = '<section><slot></slot></section>';
  expect(isSafePlacementMount(target)).toBe(true);
  shadow.innerHTML = '<button><slot></slot></button>';
  expect(isSafePlacementMount(target)).toBe(false);
  shadow.innerHTML = '<section><slot></slot></section>';
  expect(isSafePlacementMount(target)).toBe(true);
});

it('a mount inside a shadow root cannot escape its interactive outer owner', () => {
  const outer = document.createElement('section');
  const host = document.createElement('native-control');
  outer.append(host);
  document.body.append(outer);
  const shadow = host.attachShadow({ mode: 'open' });
  const target = document.createElement('span');
  shadow.append(target);
  expect(isSafePlacementMount(target)).toBe(true);
  outer.setAttribute('role', 'switch');
  expect(isSafePlacementMount(target)).toBe(false);
  outer.removeAttribute('role');
  outer.setAttribute('contenteditable', 'true');
  expect(isSafePlacementMount(target)).toBe(false);
  outer.removeAttribute('contenteditable');
  expect(isSafePlacementMount(target)).toBe(true);
});

it('the native picker exception cannot cross a surrounding shadow control', () => {
  const host = document.createElement('native-picker');
  const row = document.createElement('button');
  row.setAttribute('role', 'menuitem');
  const title = document.createElement('span');
  row.append(title);
  host.append(row);
  document.body.append(host);
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = '<section><slot></slot></section>';
  expect(isSafePlacementMount(title, row)).toBe(true);
  shadow.innerHTML = '<div role="checkbox"><slot></slot></div>';
  expect(isSafePlacementMount(title, row)).toBe(false);
  shadow.innerHTML = '<section><slot></slot></section>';
  expect(isSafePlacementMount(title, row)).toBe(true);
});
