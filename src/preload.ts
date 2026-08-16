import { contextBridge, ipcRenderer } from 'electron';
import type { BridgeEventPayload, EnvironmentConfig, PuckBridge } from './harness/bridge';

const bridge: PuckBridge = {
  status: () => ipcRenderer.invoke('harness:status'),
  providers: () => ipcRenderer.invoke('provider:list'),
  agentList: () => ipcRenderer.invoke('agent:list'),
  agentCreate: (cfg) => ipcRenderer.invoke('agent:create', cfg),
  agentUpdate: (id, cfg) => ipcRenderer.invoke('agent:update', { id, cfg }),
  agentDelete: (id) => ipcRenderer.invoke('agent:delete', id),
  agentSelect: (id) => ipcRenderer.invoke('agent:select', id),
  providerAuthStart: (id) => ipcRenderer.invoke('provider:auth-start', id),
  providerAuthLogout: (id) => ipcRenderer.invoke('provider:auth-logout', id),

  envList: () => ipcRenderer.invoke('env:list'),
  envCreate: (cfg: EnvironmentConfig) => ipcRenderer.invoke('env:create', cfg),
  envUpdate: (id, cfg) => ipcRenderer.invoke('env:update', { id, cfg }),
  envDelete: (id) => ipcRenderer.invoke('env:delete', id),
  envStart: (id) => ipcRenderer.invoke('env:start', id),
  envStop: (id) => ipcRenderer.invoke('env:stop', id),
  envRestart: (id) => ipcRenderer.invoke('env:restart', id),
  envRebuild: (id) => ipcRenderer.invoke('env:rebuild', id),
  envSecretSet: (id, key, value) => ipcRenderer.invoke('env:secret-set', { id, key, value }),
  envSecretDelete: (id, key) => ipcRenderer.invoke('env:secret-delete', { id, key }),
  envSelect: (id) => ipcRenderer.invoke('env:select', id),

  convoSave: (agentId, data) => ipcRenderer.invoke('convo:save', { agentId, data }),
  convoLoad: () => ipcRenderer.invoke('convo:load'),

  startTurn: (turnId, agentId, prompt) =>
    ipcRenderer.invoke('harness:start-turn', { turnId, agentId, prompt }),
  interrupt: (turnId) => ipcRenderer.invoke('harness:interrupt', turnId),
  answerAsk: (turnId, askId, answers) =>
    ipcRenderer.invoke('harness:answer-ask', { turnId, askId, answers }),
  onEvent: (cb) => {
    ipcRenderer.on('harness:event', (_event, payload: BridgeEventPayload) => cb(payload));
  },
};

contextBridge.exposeInMainWorld('puck', bridge);
