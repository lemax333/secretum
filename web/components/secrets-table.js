// Copyright 2016-2017 Danylo Vashchilenko
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { ep, epc, ec } from '../ui.js';
import { DataTable } from './data-table.js';
import { SecretForm } from './secret-form.js';

function SecretToolbox(props) {
  const handlers = props.actionHandlers;
  const secret = props.secret;
  const tools = [epc("a", {key: "copy", onClick: () => handlers.onCopy(secret)}, ep("i", {className: "fa fa-flash"})),
  epc("a", {key: "edit", onClick: () => handlers.onEdit(secret)}, ep("i", {className: "fa fa-edit"})),
  epc("a", {key: "remove", onClick: () => handlers.onRemove(secret)}, ep("i", {className: "fa fa-remove"}))]
  return ec("div", tools);
}

function merge(a1, a2) {
  return a1.map((a,i) => Object.assign(a,a2[i]));
}

export function SecretsTable(props) {
  const transform = secrets => {
    const actions = secrets.map(s => ({
      actions: ep(SecretToolbox, {secret: s, actionHandlers: props.actionHandlers})
    }));
    return merge(secrets, actions);
  };

  const detailsFactory = (secret) => {
    const topActions = [
      {label: 'Edit', handler: () => props.actionHandlers.onEdit(secret), icon: 'edit'},
      {label: 'Copy', handler: () => props.actionHandlers.onCopy(secret), icon: 'flash'},
      {label: 'Remove', handler: () => props.actionHandlers.onRemove(secret), icon: 'remove'}
    ];
    return ep(SecretForm, {
      className: "secret-details",
      secret: secret,
      readOnly: true,
      topActions: topActions
    });
  }

  var data;
  if(props.secrets instanceof Promise) {
    data = props.secrets.then(s => transform(s));
  } else {
    data = transform(props.secrets);
  }

  return ep(DataTable, {
    className: "secrets",
    headers: ["ID","Group", "Resource","Principal","Note","Actions"],
    columns: ["id", "groupName", "resource", "principal", "note", "actions"],
    data: data,
    detailsFactory: detailsFactory
  });
}
