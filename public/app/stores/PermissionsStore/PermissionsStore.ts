﻿import { types, getEnv, flow } from 'mobx-state-tree';
import { PermissionsStoreItem } from './PermissionsStoreItem';

const duplicateError = 'This permission exists already.';

export const permissionOptions = [
  { value: 1, label: 'View', description: 'Can view dashboards.' },
  { value: 2, label: 'Edit', description: 'Can add, edit and delete dashboards.' },
  {
    value: 4,
    label: 'Admin',
    description: 'Can add/remove permissions and can add, edit and delete dashboards.',
  },
];

export const aclTypes = [
  { value: 'Group', text: 'Team' },
  { value: 'User', text: 'User' },
  { value: 'Viewer', text: 'Everyone With Viewer Role' },
  { value: 'Editor', text: 'Everyone With Editor Role' },
];

const defaultNewType = aclTypes[0].value;

export const PermissionsStore = types
  .model('PermissionsStore', {
    fetching: types.boolean,
    isFolder: types.maybe(types.boolean),
    dashboardId: types.maybe(types.number),
    items: types.optional(types.array(PermissionsStoreItem), []),
    error: types.maybe(types.string),
    originalItems: types.optional(types.array(PermissionsStoreItem), []),
    newType: types.optional(types.string, defaultNewType),
    isInRoot: types.maybe(types.boolean),
  })
  .views(self => ({
    isValid: item => {
      const dupe = self.items.find(it => {
        return isDuplicate(it, item);
      });

      if (dupe) {
        self.error = duplicateError;
        return false;
      }

      return true;
    },
  }))
  .actions(self => ({
    load: flow(function* load(dashboardId: number, isFolder: boolean, isInRoot: boolean) {
      const backendSrv = getEnv(self).backendSrv;
      self.fetching = true;
      self.isFolder = isFolder;
      self.isInRoot = isInRoot;
      self.dashboardId = dashboardId;
      const res = yield backendSrv.get(`/api/dashboards/id/${dashboardId}/acl`);
      const items = prepareServerResponse(res, dashboardId, isFolder, isInRoot);
      self.items = items;
      self.originalItems = items;
      self.fetching = false;
      self.error = null;
    }),
    addStoreItem: flow(function* addStoreItem(item) {
      self.error = null;
      if (!self.isValid(item)) {
        return undefined;
      }

      self.items.push(prepareItem(item, self.dashboardId, self.isFolder, self.isInRoot));
      return updateItems(self);
    }),
    removeStoreItem: flow(function* removeStoreItem(idx: number) {
      self.error = null;
      self.items.splice(idx, 1);
      return updateItems(self);
    }),
    updatePermissionOnIndex: flow(function* updatePermissionOnIndex(
      idx: number,
      permission: number,
      permissionName: string
    ) {
      self.error = null;
      self.items[idx].updatePermission(permission, permissionName);
      return updateItems(self);
    }),
    setNewType(newType: string) {
      self.newType = newType;
    },
    resetNewType() {
      self.newType = defaultNewType;
    },
  }));

const updateItems = self => {
  self.error = null;

  const backendSrv = getEnv(self).backendSrv;
  const updated = [];
  for (let item of self.items) {
    if (item.inherited) {
      continue;
    }
    updated.push({
      id: item.id,
      userId: item.userId,
      teamId: item.teamId,
      role: item.role,
      permission: item.permission,
    });
  }

  let res;
  try {
    res = backendSrv.post(`/api/dashboards/id/${self.dashboardId}/acl`, {
      items: updated,
    });
  } catch (error) {
    console.error(error);
  }

  return res;
};

const prepareServerResponse = (response, dashboardId: number, isFolder: boolean, isInRoot: boolean) => {
  return response.map(item => {
    return prepareItem(item, dashboardId, isFolder, isInRoot);
  });
};

const prepareItem = (item, dashboardId: number, isFolder: boolean, isInRoot: boolean) => {
  item.inherited = !isFolder && !isInRoot && dashboardId !== item.dashboardId;

  item.sortRank = 0;
  if (item.userId > 0) {
    item.icon = 'fa fa-fw fa-user';
    item.nameHtml = item.userLogin;
    item.sortName = item.userLogin;
    item.sortRank = 10;
  } else if (item.teamId > 0) {
    item.icon = 'fa fa-fw fa-users';
    item.nameHtml = item.team;
    item.sortName = item.team;
    item.sortRank = 20;
  } else if (item.role) {
    item.icon = 'fa fa-fw fa-street-view';
    item.nameHtml = `Everyone with <span class="query-keyword">${item.role}</span> Role`;
    item.sortName = item.role;
    item.sortRank = 30;
    if (item.role === 'Viewer') {
      item.sortRank += 1;
    }
  }

  if (item.inherited) {
    item.sortRank += 100;
  }
  return item;
};

const isDuplicate = (origItem, newItem) => {
  if (origItem.inherited) {
    return false;
  }

  return (
    (origItem.role && newItem.role && origItem.role === newItem.role) ||
    (origItem.userId && newItem.userId && origItem.userId === newItem.userId) ||
    (origItem.teamId && newItem.teamId && origItem.teamId === newItem.teamId)
  );
};
