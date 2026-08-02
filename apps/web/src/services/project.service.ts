import type {
  ApiResponse,
  BuildingDto,
  BuildingListQuery,
  CreateBuildingInput,
  CreateFloorInput,
  CreateProjectInput,
  FloorDto,
  FloorListQuery,
  FloorLoadSummaryDto,
  FloorPlanDto,
  FloorPlanMetaInput,
  LinkFloorObjectsInput,
  PaginatedData,
  ProjectDto,
  ProjectListQuery,
  UpdateBuildingInput,
  UpdateFloorInput,
  UpdateProjectInput,
} from '@monhorus/shared';

import { apiClient, unwrap } from '../lib/api-client';

function toParams(query: Record<string, unknown>): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params[key] = typeof value === 'boolean' ? String(value) : (value as string | number);
  }
  return params;
}

/**
 * Project module: Project -> Building -> Floor, plus the floor's plan image and its links
 * to master-data objects. Nothing here creates an Object; a floor only references one.
 */
export const projectService = {
  async listProjects(query: ProjectListQuery = {}): Promise<PaginatedData<ProjectDto>> {
    return unwrap(
      await apiClient.get<ApiResponse<PaginatedData<ProjectDto>>>('/projects', {
        params: toParams(query as Record<string, unknown>),
      }),
    );
  },

  async getProject(projectId: string): Promise<ProjectDto> {
    return unwrap(await apiClient.get<ApiResponse<ProjectDto>>(`/projects/${projectId}`));
  },

  async createProject(payload: CreateProjectInput): Promise<ProjectDto> {
    return unwrap(await apiClient.post<ApiResponse<ProjectDto>>('/projects', payload));
  },

  async updateProject(projectId: string, payload: UpdateProjectInput): Promise<ProjectDto> {
    return unwrap(
      await apiClient.patch<ApiResponse<ProjectDto>>(`/projects/${projectId}`, payload),
    );
  },

  async deleteProject(projectId: string): Promise<void> {
    await apiClient.delete(`/projects/${projectId}`);
  },

  async listBuildings(query: BuildingListQuery = {}): Promise<PaginatedData<BuildingDto>> {
    return unwrap(
      await apiClient.get<ApiResponse<PaginatedData<BuildingDto>>>('/buildings', {
        params: toParams(query as Record<string, unknown>),
      }),
    );
  },

  async getBuilding(buildingId: string): Promise<BuildingDto> {
    return unwrap(await apiClient.get<ApiResponse<BuildingDto>>(`/buildings/${buildingId}`));
  },

  async createBuilding(payload: CreateBuildingInput): Promise<BuildingDto> {
    return unwrap(await apiClient.post<ApiResponse<BuildingDto>>('/buildings', payload));
  },

  async updateBuilding(buildingId: string, payload: UpdateBuildingInput): Promise<BuildingDto> {
    return unwrap(
      await apiClient.patch<ApiResponse<BuildingDto>>(`/buildings/${buildingId}`, payload),
    );
  },

  async deleteBuilding(buildingId: string): Promise<void> {
    await apiClient.delete(`/buildings/${buildingId}`);
  },

  async listFloors(query: FloorListQuery = {}): Promise<PaginatedData<FloorDto>> {
    return unwrap(
      await apiClient.get<ApiResponse<PaginatedData<FloorDto>>>('/floors', {
        params: toParams(query as Record<string, unknown>),
      }),
    );
  },

  async getFloor(floorId: string): Promise<FloorDto> {
    return unwrap(await apiClient.get<ApiResponse<FloorDto>>(`/floors/${floorId}`));
  },

  async createFloor(payload: CreateFloorInput): Promise<FloorDto> {
    return unwrap(await apiClient.post<ApiResponse<FloorDto>>('/floors', payload));
  },

  async updateFloor(floorId: string, payload: UpdateFloorInput): Promise<FloorDto> {
    return unwrap(await apiClient.patch<ApiResponse<FloorDto>>(`/floors/${floorId}`, payload));
  },

  async deleteFloor(floorId: string): Promise<void> {
    await apiClient.delete(`/floors/${floorId}`);
  },

  // -- Floor plan image ------------------------------------------------------

  /** Null when the floor has no plan yet; that is a normal state, not an error. */
  async getFloorPlan(floorId: string): Promise<FloorPlanDto | null> {
    return unwrap(
      await apiClient.get<ApiResponse<FloorPlanDto | null>>(`/floors/${floorId}/plan`),
    );
  },

  /** Upload or replace. One current image per floor; there is no version chain. */
  async uploadFloorPlan(
    floorId: string,
    file: File,
    meta: FloorPlanMetaInput = {},
  ): Promise<FloorPlanDto> {
    const form = new FormData();
    form.append('file', file);
    if (meta.title) form.append('title', meta.title);
    if (meta.description) form.append('description', meta.description);

    return unwrap(
      await apiClient.put<ApiResponse<FloorPlanDto>>(`/floors/${floorId}/plan`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }),
    );
  },

  async updateFloorPlanMeta(
    floorId: string,
    payload: FloorPlanMetaInput,
  ): Promise<FloorPlanDto> {
    return unwrap(
      await apiClient.patch<ApiResponse<FloorPlanDto>>(`/floors/${floorId}/plan`, payload),
    );
  },

  async removeFloorPlan(floorId: string): Promise<void> {
    await apiClient.delete(`/floors/${floorId}/plan`);
  },

  // -- Floor object links ----------------------------------------------------

  async linkObjects(floorId: string, payload: LinkFloorObjectsInput): Promise<{ linked: number }> {
    return unwrap(
      await apiClient.post<ApiResponse<{ linked: number }>>(
        `/floors/${floorId}/objects`,
        payload,
      ),
    );
  },

  async unlinkObject(floorId: string, objectId: string): Promise<void> {
    await apiClient.delete(`/floors/${floorId}/objects/${objectId}`);
  },

  async floorLoad(floorId: string): Promise<FloorLoadSummaryDto> {
    return unwrap(
      await apiClient.get<ApiResponse<FloorLoadSummaryDto>>(`/floors/${floorId}/load`),
    );
  },
};
