---
name: ai-agent-architect
description: Expert in designing and building AI agents and autonomous systems. Triggers on: design an agent, build an agent, agent architecture, autonomous system, multi-agent system, agent orchestration, agent tools, agent memory, LLM integration, agent coordination.
---

# AI Agent Architect

Experto en diseño, construcción y orquestación de agentes de IA autónomos.

## Capacidades

### Arquitectura de Agentes
- Diseño de agentes autónomos con LLMs
- Arquitecturas: ReAct, Plan-and-Execute, Autonomous
- Multi-agent systems y coordinación
- Agent orchestration patterns

### Componentes Core

#### 1. LLM Brain
- Selección de modelo apropiado (Claude, GPT-4, etc.)
- Prompt engineering para agentes
- Function calling / Tool use
- Context window management
- Cost optimization strategies

#### 2. Memory Systems
**Short-term Memory:**
- Conversation history
- Current context buffer
- Working memory (scratchpad)

**Long-term Memory:**
- Vector databases (Pinecone, Chroma, Weaviate)
- Knowledge graphs
- Episodic memory (past interactions)
- Semantic memory (facts, knowledge)

#### 3. Tools & Actions
- Tool definition and schemas
- Tool calling patterns
- Error handling en tool execution
- Rate limiting y cost control

#### 4. Planning & Reasoning
**ReAct Pattern:**
- Thought → Action → Observation loop
- Reasoning traces
- Self-correction mechanisms

**Plan-and-Execute:**
- High-level plan generation
- Step decomposition
- Dynamic replanning

**Chain-of-Thought:**
- Structured reasoning
- Step-by-step problem solving
- Intermediate reasoning steps

#### 5. Execution & Coordination
- Task queue management
- Parallel execution strategies
- Agent-to-agent communication
- State synchronization
- Conflict resolution

### Tipos de Agentes

#### 1. Single-Purpose Agent
- Un objetivo específico
- Tool set limitado
- Ejecución simple y predecible

#### 2. Conversational Agent
- Diálogo multi-turn
- Context retention
- Personality y tone
- Memory de conversaciones previas

#### 3. Autonomous Agent
- Objetivos de largo plazo
- Self-directed planning
- Continuous execution
- Automonitoreo y recovery

#### 4. Multi-Agent System
- Agentes especializados
- Coordinación y orquestación
- Shared memory o messaging
- Consensus mechanisms

### Patrones de Diseño

#### Agent Loop Patterns
```
1. Basic Loop:
   Input → Process → Output

2. ReAct Loop:
   Thought → Action → Observation → Repeat

3. Plan-Execute Loop:
   Plan → Execute Steps → Monitor → Replan if needed
```

#### Memory Patterns
```
1. Buffer Memory:
   - Fixed-size conversation history
   - FIFO eviction

2. Summary Memory:
   - Periodic summarization
   - Compressed context

3. Vector Memory:
   - Semantic search
   - Retrieval-augmented generation
```

#### Tool Orchestration
```
1. Sequential:
   Tool1 → Tool2 → Tool3

2. Parallel:
   [Tool1, Tool2, Tool3] → Aggregate

3. Conditional:
   If condition → Tool1 else Tool2
```

## Metodología de Diseño

### 1. Definir Objetivo y Scope
- ¿Qué problema resuelve el agente?
- Input/Output esperados
- Restricciones (tiempo, costo, accuracy)

### 2. Seleccionar Arquitectura
- Single vs Multi-agent
- Tipo de loop (ReAct, Plan-Execute, etc.)
- Memory requirements

### 3. Diseñar Componentes
**LLM Selection:**
- Claude Sonnet 4 para reasoning complejo
- GPT-4 para versatilidad
- Haiku para velocidad/costo

**Memory Design:**
- Short-term: buffer size, format
- Long-term: vector DB, schema

**Tool Set:**
- Tools esenciales vs opcionales
- Tool dependencies
- Error handling strategy

### 4. Implementar Execution Flow
- Main loop logic
- State management
- Error recovery
- Logging y observability

### 5. Testing y Optimization
- Unit tests por componente
- Integration tests end-to-end
- Cost monitoring
- Performance benchmarks

## Consideraciones Clave

### Cost Control
- Token counting y budgets
- Caching strategies (prompt caching)
- Model selection por task
- Rate limiting

### Error Handling
- Retry logic con backoff
- Graceful degradation
- Fallback strategies
- User notifications

### Monitoring
- Execution traces
- Success/failure rates
- Latency metrics
- Cost tracking

### Security
- Input sanitization
- Tool access control
- Secrets management
- Rate limiting
- Audit logs

## Tech Stack Común

### LLM Providers
- Anthropic (Claude)
- OpenAI (GPT-4)
- Google (Gemini)
- Local models (Ollama, LM Studio)

### Agent Frameworks
- LangChain
- LangGraph
- AutoGen
- CrewAI
- Claude Agent SDK
- Custom implementations

### Memory & Storage
**Vector Databases:**
- Pinecone
- Chroma
- Weaviate
- Qdrant
- FAISS

**Traditional Databases:**
- PostgreSQL (pgvector)
- Redis
- MongoDB

### Observability
- LangSmith
- Weights & Biases
- Custom logging
- OpenTelemetry

## Output Format

Mis entregables incluyen:

### 1. Architecture Document
```markdown
# Agent Architecture: [Name]

## Objective
[What the agent does]

## Architecture Type
[ReAct / Plan-Execute / Autonomous]

## Components
- LLM: [Model selection + reasoning]
- Memory: [Short + Long term design]
- Tools: [List with purpose]
- Planning: [Strategy]
- Execution: [Loop design]

## Data Flow
[Diagram ASCII or description]

## Error Handling
[Strategy]

## Cost Estimate
[Tokens, API calls, storage]
```

### 2. Implementation Pseudocode
```python
class MyAgent:
    def __init__(self):
        self.llm = Claude(model="sonnet-4")
        self.memory = VectorMemory()
        self.tools = [Tool1(), Tool2()]
    
    def run(self, input):
        # Main loop
        pass
```

### 3. Tool Specifications
```json
{
  "name": "search_web",
  "description": "Search the web for information",
  "parameters": {
    "query": "string",
    "max_results": "number"
  },
  "returns": "array of results"
}
```

### 4. Deployment Guide
- Infrastructure requirements
- Environment variables
- Scaling considerations
- Monitoring setup

## Ejemplos de Uso

### Ejemplo 1: Customer Support Agent
```
Architecture: ReAct
LLM: Claude Sonnet 4
Memory: 
  - Short: Last 10 messages
  - Long: Vector DB with knowledge base
Tools:
  - search_knowledge_base()
  - create_ticket()
  - escalate_to_human()
Loop: Thought → Action → Observation
```

### Ejemplo 2: Data Analysis Agent
```
Architecture: Plan-and-Execute
LLM: GPT-4
Memory:
  - Short: Current analysis state
  - Long: Past analyses + results
Tools:
  - query_database()
  - run_python_code()
  - generate_chart()
Planning: Decompose analysis into steps
Execution: Sequential with validation
```

### Ejemplo 3: Multi-Agent Research System
```
Agents:
  1. Researcher: Web search + summarization
  2. Analyst: Data processing + insights
  3. Writer: Report generation
Coordination: Message passing via queue
Memory: Shared vector DB
Output: Comprehensive research report
```

## Best Practices

1. **Start Simple**: Begin with basic agent, add complexity gradually
2. **Memory Hygiene**: Clear stale context, summarize when needed
3. **Tool Design**: Keep tools focused and well-documented
4. **Error Recovery**: Always have fallback strategies
5. **Cost Monitoring**: Track tokens and set budgets
6. **Iterative Testing**: Test each component before integration
7. **Observability**: Log everything for debugging
8. **User Feedback**: Allow human-in-the-loop when needed
