/**
 * EditCore AI - MultiAgent Client
 * Communicates with the local Agno + OpenHands sidecar engine.
 */

class MultiAgentClient {
  constructor(endpoint = {}) {
    this.baseUrl = endpoint.baseUrl || 'http://127.0.0.1:55410';
    this.token = endpoint.token || '';
  }

  setEndpoint(endpoint) {
    if (endpoint.baseUrl) this.baseUrl = endpoint.baseUrl;
    if (endpoint.token) this.token = endpoint.token;
  }

  async _request(path, method = 'GET', body = null) {
    const url = `${this.baseUrl}${path}`;
    const headers = {
      'Content-Type': 'application/json'
    };
    if (this.token) {
      headers['X-EditCore-Token'] = this.token;
    }

    const opts = { method, headers };
    if (body) {
      opts.body = JSON.stringify(body);
    }

    const res = await fetch(url, opts);
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`[MultiAgentClient] ${method} ${path} failed (${res.status}): ${errText}`);
    }
    return res.json();
  }

  async getHealth() {
    return this._request('/health');
  }

  async listAgents() {
    return this._request('/api/agents');
  }

  async submitTask({ taskId, title, spec }) {
    return this._request('/api/tasks', 'POST', {
      task_id: taskId,
      title,
      spec
    });
  }

  async getTask(taskId) {
    return this._request(`/api/tasks/${taskId}`);
  }

  async listTasks(limit = 50) {
    return this._request(`/api/tasks?limit=${limit}`);
  }

  async getMessages(taskId) {
    return this._request(`/api/tasks/${taskId}/messages`);
  }

  async cancelTask(taskId) {
    return this._request(`/api/tasks/${taskId}/cancel`, 'POST');
  }
}

module.exports = { MultiAgentClient };
