import type {
  ApiResponse,
  CreateDiagramInput,
  DiagramDto,
  DiagramListItemDto,
  DiagramViewportDto,
  ProjectGraphDto,
  UpdateDiagramInput,
} from '@monhorus/shared';

import { apiClient, unwrap } from '../lib/api-client';

/**
 * A project's objects drawn from the records.
 *
 * Read-only by construction: it is generated on every request, so there is nothing to save
 * and nothing to keep in sync.
 */
export const projectGraphService = {
  async get(projectId: string): Promise<ProjectGraphDto> {
    return unwrap(await apiClient.get<ApiResponse<ProjectGraphDto>>(`/projects/${projectId}/graph`));
  },
};

export const diagramService = {
  async list(): Promise<DiagramListItemDto[]> {
    return unwrap(await apiClient.get<ApiResponse<DiagramListItemDto[]>>('/diagrams'));
  },

  /**
   * The dashboard's canvas.
   *
   * Resolves to null when nothing has been drawn yet, which is a valid state rather than an
   * error: the page offers to start one.
   */
  async dashboard(): Promise<DiagramDto | null> {
    return unwrap(await apiClient.get<ApiResponse<DiagramDto | null>>('/diagrams/dashboard'));
  },

  async getById(diagramId: string): Promise<DiagramDto> {
    return unwrap(await apiClient.get<ApiResponse<DiagramDto>>(`/diagrams/${diagramId}`));
  },

  async create(payload: CreateDiagramInput): Promise<DiagramDto> {
    return unwrap(await apiClient.post<ApiResponse<DiagramDto>>('/diagrams', payload));
  },

  async update(diagramId: string, payload: UpdateDiagramInput): Promise<DiagramDto> {
    return unwrap(await apiClient.put<ApiResponse<DiagramDto>>(`/diagrams/${diagramId}`, payload));
  },

  /** Pan and zoom only; deliberately does not rewrite the node array. */
  async updateViewport(diagramId: string, viewport: DiagramViewportDto): Promise<DiagramDto> {
    return unwrap(
      await apiClient.patch<ApiResponse<DiagramDto>>(`/diagrams/${diagramId}/viewport`, {
        viewport,
      }),
    );
  },

  async setActiveStep(diagramId: string, activeStepId: string | null): Promise<DiagramDto> {
    return unwrap(
      await apiClient.patch<ApiResponse<DiagramDto>>(`/diagrams/${diagramId}/active-step`, {
        activeStepId,
      }),
    );
  },

  async remove(diagramId: string): Promise<void> {
    await apiClient.delete(`/diagrams/${diagramId}`);
  },
};
