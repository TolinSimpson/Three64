/**
 * sequencerStepsEditor.js - Stack-based editor for Sequencer steps.
 *
 * Renders a vertical stack of step cards with:
 * - Time, action type, action params
 * - Optional delay, randomDelay, repeat
 * - Reorder (up/down), remove
 * - Add step button
 */
import { resolveHint } from './sceneContext.js';

const DEFAULT_ACTIONS = [
  { id: 'AddItem', label: 'Add Item', params: ['target', 'item'] },
  { id: 'ModifyStatistic', label: 'Modify Statistic', params: ['name', 'op', 'value', 'duration', 'easing', 'keepRatio', 'target'] },
  { id: 'SendComponentMessage', label: 'Send Component Message', params: ['target', 'component', 'method', 'args', 'objectName'] },
  { id: 'AdvanceMatchState', label: 'Advance Match State', params: [] },
  { id: 'SetAnimState', label: 'Set Animation State', params: ['target', 'state'] },
  { id: 'NetworkAction', label: 'Send Network Action', params: ['action', 'params'] },
  { id: 'RequestRespawn', label: 'Request Respawn', params: ['playerId'] },
  { id: 'TimerControl', label: 'Timer Control', params: ['target', 'timerName', 'action'] },
  { id: 'SpawnFromPool', label: 'Spawn From Pool', params: ['archetype', 'target', 'overrides', 'traits', 'position', 'objectName'] },
  { id: 'FireProjectile', label: 'Fire Projectile', params: ['archetype', 'direction', 'speed', 'target'] },
  { id: 'EmitParticles', label: 'Emit Particles', params: ['count', 'scale', 'target', 'position'] },
  { id: 'SetVisible', label: 'Set Visible', params: ['target', 'visible', 'objectName'] },
  { id: 'EmitEvent', label: 'Emit Event', params: ['event', 'payload'] },
  { id: 'SequencerControl', label: 'Sequencer Control', params: ['target', 'sequencerName', 'action', 'objectName', 'time'] },
];

/**
 * Build the stack-based steps editor DOM.
 *
 * @param {Array} steps - Current steps array
 * @param {Function} onChange - Called with new steps array when changed
 * @param {Array} [actions] - Action definitions from API
 * @param {import('./sceneContext.js').SceneContext} [context] - Scene context for hints
 * @returns {HTMLElement}
 */
export function buildSequencerStepsEditor(steps, onChange, actions, context) {
  const actionsList = Array.isArray(actions) && actions.length > 0 ? actions : DEFAULT_ACTIONS;
  const stepsArr = Array.isArray(steps) ? [...steps] : [];

  const row = document.createElement('div');
  row.className = 'prop-row sequencer-steps-row';

  const lbl = document.createElement('span');
  lbl.className = 'prop-label';
  lbl.textContent = 'Steps';
  lbl.title = 'Timed sequence of actions. Add, reorder, or remove steps.';
  row.appendChild(lbl);

  const valDiv = document.createElement('div');
  valDiv.className = 'prop-value sequencer-stack-editor';

  const stack = document.createElement('div');
  stack.className = 'sequencer-stack';

  function emit() {
    onChange(stepsArr);
  }

  function buildStepCard(step, index) {
    const card = document.createElement('div');
    card.className = 'sequencer-step-card';
    card.dataset.index = String(index);

    const header = document.createElement('div');
    header.className = 'sequencer-step-header';

    const timeInp = document.createElement('input');
    timeInp.type = 'number';
    timeInp.min = 0;
    timeInp.step = 0.1;
    timeInp.value = step.time ?? 0;
    timeInp.placeholder = 't';
    timeInp.title = 'Time (s)';
    timeInp.className = 'sequencer-step-time';
    timeInp.addEventListener('change', () => {
      step.time = parseFloat(timeInp.value) || 0;
      emit();
    });

    const actionSel = document.createElement('select');
    actionSel.className = 'sequencer-step-action';
    actionSel.title = 'Action type';
    const emptyOpt = document.createElement('option');
    emptyOpt.value = '';
    emptyOpt.textContent = '-- Action --';
    actionSel.appendChild(emptyOpt);
    for (const a of actionsList) {
      const o = document.createElement('option');
      o.value = a.id;
      o.textContent = a.label;
      if ((step.action?.type || step.action?.id) === a.id) o.selected = true;
      actionSel.appendChild(o);
    }
    actionSel.addEventListener('change', () => {
      step.action = step.action || {};
      step.action.type = step.action.id = actionSel.value;
      step.action.params = step.action.params || {};
      emit();
      rebuild();
    });

    const moveUp = document.createElement('button');
    moveUp.className = 'sequencer-step-btn';
    moveUp.textContent = '\u25B2';
    moveUp.title = 'Move up';
    moveUp.addEventListener('click', () => {
      if (index <= 0) return;
      [stepsArr[index], stepsArr[index - 1]] = [stepsArr[index - 1], stepsArr[index]];
      emit();
      rebuild();
    });

    const moveDown = document.createElement('button');
    moveDown.className = 'sequencer-step-btn';
    moveDown.textContent = '\u25BC';
    moveDown.title = 'Move down';
    moveDown.addEventListener('click', () => {
      if (index >= stepsArr.length - 1) return;
      [stepsArr[index], stepsArr[index + 1]] = [stepsArr[index + 1], stepsArr[index]];
      emit();
      rebuild();
    });

    const removeBtn = document.createElement('button');
    removeBtn.className = 'sequencer-step-btn sequencer-step-remove';
    removeBtn.textContent = '\u2715';
    removeBtn.title = 'Remove step';
    removeBtn.addEventListener('click', () => {
      stepsArr.splice(index, 1);
      emit();
      rebuild();
    });

    header.appendChild(timeInp);
    header.appendChild(actionSel);
    header.appendChild(moveUp);
    header.appendChild(moveDown);
    header.appendChild(removeBtn);
    card.appendChild(header);

    const body = document.createElement('div');
    body.className = 'sequencer-step-body';

    const actionType = step.action?.type || step.action?.id || actionSel.value;
    if (actionType) {
      const actionDef = actionsList.find(a => a.id === actionType);
      const params = step.action?.params || {};
      const paramKeys = actionDef?.params || [];

      for (const pk of paramKeys) {
        if (!pk) continue;
        const hintList = context ? resolveHint('Sequencer', pk, null) : null;
        const hintOpts = hintList && context?.[hintList] ? context[hintList] : null;
        const pval = params[pk];
        const paramRow = document.createElement('div');
        paramRow.className = 'sequencer-param-row';

        const plbl = document.createElement('span');
        plbl.className = 'sequencer-param-label';
        plbl.textContent = pk;
        paramRow.appendChild(plbl);

        const pvalDiv = document.createElement('div');
        pvalDiv.className = 'sequencer-param-value';

        if (hintOpts && hintOpts.length > 0) {
          const sel = document.createElement('select');
          const customOpt = document.createElement('option');
          customOpt.value = '__custom__';
          customOpt.textContent = '(custom)';
          sel.appendChild(customOpt);
          let matchFound = false;
          for (const opt of hintOpts) {
            const o = document.createElement('option');
            o.value = opt;
            o.textContent = opt;
            if (String(opt) === String(pval)) { o.selected = true; matchFound = true; }
            sel.appendChild(o);
          }
          const inp = document.createElement('input');
          inp.type = 'text';
          inp.value = pval ?? '';
          inp.style.display = matchFound ? 'none' : 'block';
          if (!matchFound) customOpt.selected = true;
          sel.addEventListener('change', () => {
            if (sel.value === '__custom__') {
              inp.style.display = 'block';
            } else {
              inp.style.display = 'none';
              params[pk] = sel.value;
              emit();
            }
          });
          inp.addEventListener('change', () => {
            params[pk] = inp.value;
            emit();
          });
          pvalDiv.appendChild(sel);
          pvalDiv.appendChild(inp);
        } else {
          const inp = document.createElement('input');
          inp.type = 'text';
          inp.value = typeof pval === 'object' ? JSON.stringify(pval) : (pval ?? '');
          inp.placeholder = pk;
          inp.addEventListener('change', () => {
            const v = inp.value.trim();
            try {
              params[pk] = /^[\[\{]/.test(v) ? JSON.parse(v) : v;
            } catch {
              params[pk] = v;
            }
            emit();
          });
          pvalDiv.appendChild(inp);
        }
        paramRow.appendChild(pvalDiv);
        body.appendChild(paramRow);
      }

      const optsRow = document.createElement('div');
      optsRow.className = 'sequencer-step-opts';

      const delayInp = document.createElement('input');
      delayInp.type = 'number';
      delayInp.min = 0;
      delayInp.step = 0.1;
      delayInp.placeholder = 'delay';
      delayInp.title = 'Delay (s)';
      delayInp.value = step.delay ?? '';
      delayInp.addEventListener('change', () => {
        const v = parseFloat(delayInp.value);
        if (Number.isFinite(v) && v >= 0) step.delay = v;
        else delete step.delay;
        emit();
      });

      const repeatInp = document.createElement('input');
      repeatInp.type = 'number';
      repeatInp.min = 1;
      repeatInp.step = 1;
      repeatInp.placeholder = '×';
      repeatInp.title = 'Repeat count';
      repeatInp.value = step.repeat > 1 ? step.repeat : '';
      repeatInp.addEventListener('change', () => {
        const v = parseInt(repeatInp.value, 10);
        if (Number.isFinite(v) && v > 1) step.repeat = v;
        else delete step.repeat;
        emit();
      });

      optsRow.appendChild(delayInp);
      optsRow.appendChild(repeatInp);
      body.appendChild(optsRow);
    }

    card.appendChild(body);
    return card;
  }

  function rebuild() {
    stack.innerHTML = '';
    for (let i = 0; i < stepsArr.length; i++) {
      stack.appendChild(buildStepCard(stepsArr[i], i));
    }

    const addBtn = document.createElement('button');
    addBtn.className = 'sequencer-add-btn';
    addBtn.textContent = '+ Add Step';
    addBtn.addEventListener('click', () => {
      stepsArr.push({
        time: stepsArr.length > 0 ? (stepsArr[stepsArr.length - 1].time || 0) + 1 : 0,
        action: { type: 'ModifyStatistic', params: {} },
      });
      emit();
      rebuild();
    });
    stack.appendChild(addBtn);
  }

  rebuild();
  valDiv.appendChild(stack);
  row.appendChild(valDiv);

  return row;
}
