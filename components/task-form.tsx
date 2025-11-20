'use client'

import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Loader2, ArrowUp, Settings, X, Cable } from 'lucide-react'
import { Claude, Codex, Copilot, Cursor, Gemini, OpenCode } from '@/components/logos'
import { setInstallDependencies, setMaxDuration, setKeepAlive } from '@/lib/utils/cookies'
import { useConnectors } from '@/components/connectors-provider'
import { ConnectorDialog } from '@/components/connectors/manage-connectors'
import { toast } from 'sonner'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { taskPromptAtom } from '@/lib/atoms/task'
import { lastSelectedAgentAtom, lastSelectedModelAtomFamily } from '@/lib/atoms/agent-selection'
import { githubReposAtomFamily } from '@/lib/atoms/github-cache'
import { useSearchParams } from 'next/navigation'

interface GitHubRepo {
  name: string
  full_name: string
  description: string
  private: boolean
  clone_url: string
  language: string
}

interface TaskFormProps {
  onSubmit: (data: {
    prompt: string
    repoUrl: string
    selectedAgent: string
    selectedModel: string
    selectedModels?: string[]
    installDependencies: boolean
    maxDuration: number
    keepAlive: boolean
  }) => void
  isSubmitting: boolean
  selectedOwner: string
  selectedRepo: string
  initialInstallDependencies?: boolean
  initialMaxDuration?: number
  initialKeepAlive?: boolean
  maxSandboxDuration?: number
}

const CODING_AGENTS = [
  { value: 'codex', label: 'Codex', icon: Codex, isLogo: true },
  { value: 'claude', label: 'Claude', icon: Claude, isLogo: true },
  { value: 'opencode', label: 'Opencode', icon: OpenCode, isLogo: true },
] as const

// Model options for each agent
const AGENT_MODELS = {
  codex: [{ value: 'gpt-5.1-codex', label: 'GPT-5.1-Codex' }],
  claude: [{ value: 'claude-sonnet-4-5-20250929', label: 'Sonnet 4.5' }],
  opencode: [{ value: 'gemini-3-pro-preview', label: 'Gemini 3 Pro' }],
} as const

// Default models for each agent
const DEFAULT_MODELS = {
  codex: 'gpt-5.1-codex',
  claude: 'claude-sonnet-4-5-20250929',
  opencode: 'gemini-3-pro-preview',
} as const

// API key requirements for each agent
const AGENT_API_KEY_REQUIREMENTS: Record<string, Provider[]> = {
  claude: ['anthropic'],
  codex: ['aigateway'], // Uses AI Gateway for OpenAI proxy
  opencode: [], // Will be determined dynamically based on selected model
}

type Provider = 'openai' | 'gemini' | 'cursor' | 'anthropic' | 'aigateway'

// Helper to determine which API key is needed for opencode based on model
const getOpenCodeRequiredKeys = (model: string): Provider[] => {
  // Check if it's a Gemini model
  if (model.includes('gemini')) {
    return ['gemini']
  }
  // Check if it's an Anthropic model (claude models)
  if (model.includes('claude') || model.includes('sonnet') || model.includes('opus')) {
    return ['anthropic']
  }
  // Check if it's an OpenAI/GPT model (uses AI Gateway)
  if (model.includes('gpt')) {
    return ['aigateway']
  }
  // Fallback to both if we can't determine
  return ['aigateway', 'anthropic']
}

export function TaskForm({
  onSubmit,
  isSubmitting,
  selectedOwner,
  selectedRepo,
  initialInstallDependencies = false,
  initialMaxDuration = 300,
  initialKeepAlive = false,
  maxSandboxDuration = 300,
}: TaskFormProps) {
  const [prompt, setPrompt] = useAtom(taskPromptAtom)
  const [savedAgent, setSavedAgent] = useAtom(lastSelectedAgentAtom)
  const defaultAgent = 'codex'
  const [selectedAgent, setSelectedAgent] = useState<string>(
    savedAgent && CODING_AGENTS.some((agent) => agent.value === savedAgent) ? savedAgent : defaultAgent,
  )
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_MODELS[defaultAgent])
  const [repos, setRepos] = useAtom(githubReposAtomFamily(selectedOwner))
  const [, setLoadingRepos] = useState(false)

  // Options state - initialize with server values
  const [installDependencies, setInstallDependenciesState] = useState(initialInstallDependencies)
  const [maxDuration, setMaxDurationState] = useState(initialMaxDuration)
  const [keepAlive, setKeepAliveState] = useState(initialKeepAlive)
  const [showMcpServersDialog, setShowMcpServersDialog] = useState(false)

  // Connectors state
  const { connectors } = useConnectors()

  // Ref for the textarea to focus it programmatically
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Wrapper functions to update both state and cookies
  const updateInstallDependencies = (value: boolean) => {
    setInstallDependenciesState(value)
    setInstallDependencies(value)
  }

  const updateMaxDuration = (value: number) => {
    setMaxDurationState(value)
    setMaxDuration(value)
  }

  const updateKeepAlive = (value: boolean) => {
    setKeepAliveState(value)
    setKeepAlive(value)
  }

  // Handle keyboard events in textarea
  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter') {
      // On desktop: Enter submits, Shift+Enter creates new line
      // On mobile: Enter creates new line, must use submit button
      const isMobile = typeof window !== 'undefined' && window.innerWidth < 768
      if (!isMobile && !e.shiftKey) {
        e.preventDefault()
        if (prompt.trim()) {
          // Find the form and submit it
          const form = e.currentTarget.closest('form')
          if (form) {
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
          }
        }
      }
      // For all other cases (mobile Enter, desktop Shift+Enter), let default behavior create new line
    }
  }

  // Get URL search params
  const searchParams = useSearchParams()

  // Load saved agent, model, and options on mount, and focus the prompt input
  useEffect(() => {
    // Check URL params first
    const urlAgent = searchParams?.get('agent')
    const urlModel = searchParams?.get('model')

    if (
      urlAgent &&
      CODING_AGENTS.some((agent) => agent.value === urlAgent && !('isDivider' in agent && agent.isDivider))
    ) {
      setSelectedAgent(urlAgent)
      if (urlModel) {
        const agentModels = AGENT_MODELS[urlAgent as keyof typeof AGENT_MODELS]
        if (agentModels?.some((model) => model.value === urlModel)) {
          setSelectedModel(urlModel)
        }
      }
    } else if (savedAgent) {
      // Fall back to saved agent from Jotai atom
      if (CODING_AGENTS.some((agent) => agent.value === savedAgent && !('isDivider' in agent && agent.isDivider))) {
        setSelectedAgent(savedAgent)
      }
    }

    // Options are now initialized from server props, no need to load from cookies

    // Focus the prompt input when the component mounts
    if (textareaRef.current) {
      textareaRef.current.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Get saved model atom for current agent
  const savedModelAtom = lastSelectedModelAtomFamily(selectedAgent)
  const savedModel = useAtomValue(savedModelAtom)
  const setSavedModel = useSetAtom(savedModelAtom)

  // Update model when agent changes
  useEffect(() => {
    if (selectedAgent) {
      // Load saved model for this agent or use default
      const agentModels = AGENT_MODELS[selectedAgent as keyof typeof AGENT_MODELS]
      if (savedModel && agentModels?.some((model) => model.value === savedModel)) {
        setSelectedModel(savedModel)
      } else {
        const defaultModel = DEFAULT_MODELS[selectedAgent as keyof typeof DEFAULT_MODELS]
        if (defaultModel) {
          setSelectedModel(defaultModel)
        }
      }
    }
  }, [selectedAgent, savedModel])

  // Fetch repositories when owner changes
  useEffect(() => {
    if (!selectedOwner) {
      setRepos(null)
      return
    }

    const fetchRepos = async () => {
      setLoadingRepos(true)
      try {
        // Check cache first (repos is from the atom)
        if (repos && repos.length > 0) {
          setLoadingRepos(false)
          return
        }

        const response = await fetch(`/api/github/repos?owner=${selectedOwner}`)
        if (response.ok) {
          const reposList = await response.json()
          setRepos(reposList)
        }
      } catch (error) {
        console.error('Error fetching repositories:', error)
      } finally {
        setLoadingRepos(false)
      }
    }

    fetchRepos()
  }, [selectedOwner, repos, setRepos])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!prompt.trim()) {
      return
    }

    // If owner/repo not selected, let parent handle it (will show sign-in if needed)
    // Don't clear localStorage here - user might need to sign in and come back
    if (!selectedOwner || !selectedRepo) {
      onSubmit({
        prompt: prompt.trim(),
        repoUrl: '',
        selectedAgent,
        selectedModel,
        installDependencies,
        maxDuration,
        keepAlive,
      })
      return
    }

    // Check if API key is required and available for the selected agent and model
    // Skip this check if we don't have repo data (likely not signed in)
    const selectedRepoData = repos?.find((repo) => repo.name === selectedRepo)

    if (selectedRepoData) {
      try {
        const response = await fetch(`/api/api-keys/check?agent=${selectedAgent}&model=${selectedModel}`)
        const data = await response.json()

        if (!data.hasKey) {
          // Show error message with provider name
          const providerNames: Record<string, string> = {
            anthropic: 'Anthropic',
            openai: 'OpenAI',
            cursor: 'Cursor',
            gemini: 'Gemini',
            aigateway: 'AI Gateway',
          }
          const providerName = providerNames[data.provider] || data.provider

          toast.error(`${providerName} API key required`, {
            description: `Please add your ${providerName} API key in the user menu to use the ${data.agentName} agent with this model.`,
          })
          return
        }
      } catch (error) {
        console.error('Error checking API key:', error)
        // Don't show error toast - might just be not authenticated, let parent handle it
      }
    }

    onSubmit({
      prompt: prompt.trim(),
      repoUrl: selectedRepoData?.clone_url || '',
      selectedAgent,
      selectedModel,
      installDependencies,
      maxDuration,
      keepAlive,
    })
  }

  return (
    <div className="w-full max-w-2xl">
      <div className="text-center mb-8">
        <div className="flex items-center justify-center mb-4">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-red-500/20 bg-red-500/10">
            <div className="w-2 h-2 rounded-full bg-red-500"></div>
            <span className="text-sm font-medium tracking-widest">MOJOCODE</span>
          </div>
        </div>
        <h1 className="text-5xl md:text-6xl font-bold mb-6">Build. Cool. Shit.</h1>
        <p className="text-lg text-muted-foreground max-w-3xl mx-auto px-4">
          Mojo and his team of jaded, and annoyed agents totally dominate your project. Add a feature. Fix a bug. What
          does it matter? A prompt is all you have to worry about. The crew is doing all the work.
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="relative border rounded-2xl shadow-sm overflow-hidden bg-muted/30 cursor-text">
          {/* Prompt Input */}
          <div className="relative bg-transparent">
            <Textarea
              ref={textareaRef}
              id="prompt"
              placeholder="Design a deployment pipeline, refactor a module, or craft a new feature brief..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleTextareaKeyDown}
              disabled={isSubmitting}
              required
              rows={4}
              className="w-full border-0 resize-none focus-visible:ring-0 focus-visible:ring-offset-0 p-4 text-base !bg-transparent shadow-none!"
            />
          </div>

          {/* Agent Selection */}
          <div className="p-4">
            <div className="flex items-center justify-between gap-2">
              {/* Left side: Agent, Model, and Option Chips */}
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {/* Agent Selection - Icon only on mobile, minimal width */}
                <Select
                  value={selectedAgent}
                  onValueChange={(value) => {
                    setSelectedAgent(value)
                    // Save to Jotai atom immediately
                    setSavedAgent(value)
                  }}
                  disabled={isSubmitting}
                >
                  <SelectTrigger className="w-auto sm:min-w-[120px] border-0 bg-transparent shadow-none focus:ring-0 h-8 shrink-0">
                    <SelectValue placeholder="Agent">
                      {selectedAgent &&
                        (() => {
                          const agent = CODING_AGENTS.find((a) => a.value === selectedAgent)
                          return agent ? (
                            <div className="flex items-center gap-2">
                              <agent.icon className="w-4 h-4" />
                              <span className="hidden sm:inline">{agent.label}</span>
                            </div>
                          ) : null
                        })()}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {CODING_AGENTS.map((agent) => {
                      if ('isDivider' in agent && agent.isDivider) {
                        return <div key={agent.value} className="h-px bg-border my-1" />
                      }
                      return (
                        <SelectItem key={agent.value} value={agent.value}>
                          <div className="flex items-center gap-2">
                            <agent.icon className="w-4 h-4" />
                            <span>{agent.label}</span>
                          </div>
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>

                {/* Model Selection - Fills available width on mobile */}
                <Select
                  value={selectedModel}
                  onValueChange={(value) => {
                    setSelectedModel(value)
                    // Save to Jotai atom immediately
                    setSavedModel(value)
                  }}
                  disabled={isSubmitting}
                >
                  <SelectTrigger className="flex-1 sm:flex-none sm:w-auto sm:min-w-[140px] border-0 bg-transparent shadow-none focus:ring-0 h-8 min-w-0">
                    <SelectValue placeholder="Model" className="truncate" />
                  </SelectTrigger>
                  <SelectContent>
                    {AGENT_MODELS[selectedAgent as keyof typeof AGENT_MODELS]?.map((model) => (
                      <SelectItem key={model.value} value={model.value}>
                        {model.label}
                      </SelectItem>
                    )) || []}
                  </SelectContent>
                </Select>

                {/* Option Chips - Only visible on desktop */}
                {(!installDependencies || maxDuration !== maxSandboxDuration || keepAlive) && (
                  <div className="hidden sm:flex items-center gap-2 flex-wrap">
                    {!installDependencies && (
                      <Badge variant="secondary" className="text-xs h-6 px-2 gap-1 bg-transparent border-0">
                        Skip Install
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-3 w-3 p-0 hover:bg-transparent"
                          onClick={(e) => {
                            e.stopPropagation()
                            updateInstallDependencies(true)
                          }}
                        >
                          <X className="h-2 w-2" />
                        </Button>
                      </Badge>
                    )}
                    {maxDuration !== maxSandboxDuration && (
                      <Badge variant="secondary" className="text-xs h-6 px-2 gap-1 bg-transparent border-0">
                        {maxDuration}m
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-3 w-3 p-0 hover:bg-transparent"
                          onClick={(e) => {
                            e.stopPropagation()
                            updateMaxDuration(maxSandboxDuration)
                          }}
                        >
                          <X className="h-2 w-2" />
                        </Button>
                      </Badge>
                    )}
                    {keepAlive && (
                      <Badge variant="secondary" className="text-xs h-6 px-2 gap-1 bg-transparent border-0">
                        Keep Alive
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-3 w-3 p-0 hover:bg-transparent"
                          onClick={(e) => {
                            e.stopPropagation()
                            updateKeepAlive(false)
                          }}
                        >
                          <X className="h-2 w-2" />
                        </Button>
                      </Badge>
                    )}
                  </div>
                )}
              </div>

              {/* Right side: Action Icons and Submit Button */}
              <div className="flex items-center gap-2 shrink-0">
                {/* Buttons */}
                <div className="flex items-center gap-2">
                  <TooltipProvider delayDuration={1500} skipDelayDuration={1500}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="rounded-full h-8 w-8 p-0 relative"
                          onClick={() => setShowMcpServersDialog(true)}
                        >
                          <Cable className="h-4 w-4" />
                          {connectors.filter((c) => c.status === 'connected').length > 0 && (
                            <Badge
                              variant="secondary"
                              className="absolute -top-1 -right-1 h-4 min-w-4 p-0 flex items-center justify-center text-[10px] rounded-full"
                            >
                              {connectors.filter((c) => c.status === 'connected').length}
                            </Badge>
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>MCP Servers</p>
                      </TooltipContent>
                    </Tooltip>

                    <DropdownMenu>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="rounded-full h-8 w-8 p-0 relative"
                            >
                              <Settings className="h-4 w-4" />
                              {(() => {
                                const customOptionsCount = [
                                  !installDependencies,
                                  maxDuration !== maxSandboxDuration,
                                  keepAlive,
                                ].filter(Boolean).length
                                return customOptionsCount > 0 ? (
                                  <Badge
                                    variant="secondary"
                                    className="absolute -top-1 -right-1 h-4 min-w-4 p-0 flex items-center justify-center text-[10px] rounded-full sm:hidden"
                                  >
                                    {customOptionsCount}
                                  </Badge>
                                ) : null
                              })()}
                            </Button>
                          </DropdownMenuTrigger>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Task Options</p>
                        </TooltipContent>
                      </Tooltip>
                      <DropdownMenuContent className="w-72" align="end">
                        <DropdownMenuLabel>Task Options</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <div className="p-2 space-y-4">
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              id="install-deps"
                              checked={installDependencies}
                              onCheckedChange={(checked) => updateInstallDependencies(checked === true)}
                            />
                            <Label
                              htmlFor="install-deps"
                              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                            >
                              Install Dependencies?
                            </Label>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="max-duration" className="text-sm font-medium">
                              Maximum Duration
                            </Label>
                            <Select
                              value={maxDuration.toString()}
                              onValueChange={(value) => updateMaxDuration(parseInt(value))}
                            >
                              <SelectTrigger id="max-duration" className="w-full h-8">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="5">5 minutes</SelectItem>
                                <SelectItem value="10">10 minutes</SelectItem>
                                <SelectItem value="15">15 minutes</SelectItem>
                                <SelectItem value="30">30 minutes</SelectItem>
                                <SelectItem value="45">45 minutes</SelectItem>
                                <SelectItem value="60">1 hour</SelectItem>
                                <SelectItem value="120">2 hours</SelectItem>
                                <SelectItem value="180">3 hours</SelectItem>
                                <SelectItem value="240">4 hours</SelectItem>
                                <SelectItem value="300">5 hours</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <div className="flex items-center space-x-2">
                              <Checkbox
                                id="keep-alive"
                                checked={keepAlive}
                                onCheckedChange={(checked) => updateKeepAlive(checked === true)}
                              />
                              <Label
                                htmlFor="keep-alive"
                                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                              >
                                Keep Alive ({maxSandboxDuration}m max)
                              </Label>
                            </div>
                            <p className="text-xs text-muted-foreground pl-6">Keep sandbox running after completion.</p>
                          </div>
                        </div>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TooltipProvider>

                  <Button
                    type="submit"
                    disabled={isSubmitting || !prompt.trim()}
                    size="sm"
                    className="rounded-full h-8 w-8 p-0"
                  >
                    {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </form>

      <ConnectorDialog open={showMcpServersDialog} onOpenChange={setShowMcpServersDialog} />
    </div>
  )
}
