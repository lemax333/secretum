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

/* global React ReactDOM */

import { HomePage } from './pages/home.js';
import { EditSecretPage } from './pages/edit-secret.js';
import { ep, epc } from './ui.js';
import { Router } from './router.js';
import { Model } from './model.js';

Map.fromObject = function(obj) {
	const map = new Map();
	for(var key in obj) {
		map.set(key,obj[key]);
	}
	return map;
}

class App extends React.Component {
	constructor(props) {
		super(props);
	}

	render() {
		var rules = [
			["/", ep(HomePage,{model: this.props.model})],
			["/secrets/{id}", id => ep(EditSecretPage, {model: this.props.model, secret:this.props.model.get(Number.parseInt(id))})]
		];
		return epc("div", {className: "app"}, [
			epc("div", {key: "header", className: "header"}, "Secretum"),
			ep(Router, {key: "router", className: "page", rules: rules, id: "router-main"}),
			epc("div", {key: "footer", className: "footer"}, "Keep your secrets safe!")
		]);
	}

	static get model() {
		return App._model;
	}
}
App._model = new Model("/api");

document.addEventListener("DOMContentLoaded", function() {
	ReactDOM.render(ep(App, {model: App.model}), document.getElementById("root"));
});
